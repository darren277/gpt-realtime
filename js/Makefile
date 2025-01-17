include .env

# OPTIONAL:

ngrok:
	docker run --net=host -it -e NGROK_AUTHTOKEN=$(NGROK_AUTHTOKEN) ngrok/ngrok:latest http --log=stdout --url=$(NGROK_URL) http://host.docker.internal:$(NGROK_PORT)
