# gpt-realtime

## Python version

An implementation of the GPT Real Time API using WebSockets. It is built in Flask and has a very simple single page for the front end that uses vanilla HTML and JavaScript.

So far, it successfully interacts with the Real Time API (using the `gpt-4o-realtime-preview-2024-12-17` beta model). It handles voice that is recorded via the browser and converted using `ffmpeg` (server side as a subprocess).

It still needs some tweaking to get the live prompts working right as the last testing resulted in it simply repeating back what I had said to it.
