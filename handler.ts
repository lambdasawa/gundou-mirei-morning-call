import {
  APIGatewayProxyEvent,
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
} from "aws-lambda";
import * as AWS from "aws-sdk";
import * as Axios from "axios";
import "source-map-support/register";
import * as twilio from "twilio";

const config = {
  aws: {
    bucketName: process.env.S3_BUCKET_NAME || "",
    objectKey: "state.json",
  },
  twitcasting: {
    userId: process.env.TWITCASTING_USER_ID || "",
    accessToken: process.env.TWITCASTING_ACCESS_TOKEN || "",
  },
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_ID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    from: process.env.PHONE_NUMBER_FROM || "",
    to: process.env.PHONE_NUMBER_TO || "",
    voiceURL: process.env.TWILIO_VOICE_URL || "",
    text: process.env.VOICE_TEXT,
  },
};

type State = {
  knownTwitCastingMovieIds: string[];
};

async function fetchState(): Promise<State> {
  console.log({ msg: "fetch state", status: "start" });

  try {
    const s3 = new AWS.S3();
    const obj = await s3
      .getObject({ Bucket: config.aws.bucketName, Key: config.aws.objectKey })
      .promise();
    const body = obj.Body.toString();
    console.log({ msg: "fetch state", status: "success", body });

    const state = JSON.parse(body) as State;

    return { ...state };
  } catch (e) {
    console.error({ msg: "fetch state", status: "failure", error: e });

    return { knownTwitCastingMovieIds: [] };
  }
}

async function saveState(state: State): Promise<void> {
  console.log({ msg: "save state", status: "start", state });

  const s3 = new AWS.S3();
  await s3
    .putObject({
      Bucket: config.aws.bucketName,
      Key: config.aws.objectKey,
      Body: JSON.stringify(state),
    })
    .promise();

  console.log({ msg: "save state", status: "success" });

  return;
}

async function findCurrentTwitCastingLive(
  userId: string
): Promise<string | null> {
  console.log({ msg: "find current twitcas live", status: "start", userId });

  const response = await Axios.default.get<any>(
    `https://apiv2.twitcasting.tv/users/${userId}/current_live`,
    {
      headers: {
        Accept: "application/json",
        "X-Api-Version": "2.0",
        Authorization: `Bearer ${config.twitcasting.accessToken}`,
      },
      validateStatus: (status) => {
        return status < 500;
      },
    }
  );
  console.log({
    msg: "find current twitcas live",
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config: response.config,
  });

  if (response.status >= 400) {
    console.log({ msg: "find current twitcas live", status: "failure" });
    return null;
  }

  return response.data.movie.id;
}

async function createPhoneCall(): Promise<unknown> {
  console.log({
    msg: "create call",
    status: "start",
  });

  const call = await twilio(
    config.twilio.accountSid,
    config.twilio.authToken
  ).calls.create({
    url: config.twilio.voiceURL,
    to: config.twilio.to,
    from: config.twilio.from,
  });

  console.log({
    msg: "create call",
    status: "success",
    call,
  });

  return;
}

function generateTriggerResult(
  statusCode: number,
  message: string,
  event: APIGatewayProxyEvent
): APIGatewayProxyResult {
  return {
    statusCode,
    body: JSON.stringify({
      message,
      event,
    }),
  };
}

function isMovieNew(state: State, movieId: string): boolean {
  return !state.knownTwitCastingMovieIds.includes(movieId);
}

function buildNewState(state: State, movieId: string): State {
  const newState = { ...state };
  newState.knownTwitCastingMovieIds.push(movieId);

  return newState;
}

export const trigger: APIGatewayProxyHandler = async (event, _context) => {
  const movieId = await findCurrentTwitCastingLive(config.twitcasting.userId);
  if (!movieId) {
    return generateTriggerResult(200, "twitcasting user is offline", event);
  }

  const state = await fetchState();

  if (isMovieNew(state, movieId)) {
    console.log({ msg: "found new movie", state, movieId });

    await saveState(buildNewState(state, movieId));

    await createPhoneCall();
  }

  return generateTriggerResult(200, "Phone call created.", event);
};

function generateVoiceXMLResult(text: string): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/xml",
    },
    body: [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<Response>`,
      `  <Play>http://speech.gundou-mirei.love/speech?text=${text}</Play>`,
      `</Response>`,
    ].join("\n"),
  };
}

export const voiceXMLGenerator: APIGatewayProxyHandler = async (
  _event,
  _context
) => {
  return generateVoiceXMLResult(config.twilio.text);
};
