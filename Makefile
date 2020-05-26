.PHONY: deploy undeploy

deploy:
	yarn
	yarn sls deploy

undeploy:
	yarn
	yarn sls remove
