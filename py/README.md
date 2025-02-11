# About

This project consists of handling two separate ongoing WebSocket connections:
1. Between backend server and another 3rd party (OpenAI) server, for handling the Realtime API events.
2. Between frontend scripts and backend server. This one will have to intercept all of the Realtime event traffic and route certain events between, and sometimes send new events to the backend WebSocket connection to OpenAI as well.

## Misc

Some snippets from the documentation:

`If you are using WebSockets for audio, you will need to manually interact with the input audio buffer as well as the objects listed above. You'll be responsible for sending and receiving Base64-encoded audio bytes, and handling those as appropriate in your integration code.`
