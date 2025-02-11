export default class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
        this.connect();
    }

    connect() {
        //this.socket = new WebSocket(this.url);
        // Using socket.io.js instead:
        this.socket = new io(this.url);

        // Bind event handlers
        this.socket.onopen = (event) => this.handleOpen(event);
        this.socket.onmessage = (event) => this.handleMessage(event);
        this.socket.onerror = (error) => this.handleError(error);
        this.socket.onclose = (event) => this.handleClose(event);
    }

    // Override these methods as needed in your application
    handleOpen(event) {
        console.log('WebSocket connection opened:', event);
        if (this.onOpen) this.onOpen(event);
    }

    handleMessage(event) {
        console.log('WebSocket message received:', event.data);
        if (this.onMessage) this.onMessage(event);
    }

    handleError(error) {
        console.error('WebSocket error:', error);
        if (this.onError) this.onError(error);
    }

    handleClose(event) {
        console.log('WebSocket connection closed:', event);
        if (this.onClose) this.onClose(event);
        // Optionally, you might want to reconnect here:
        // this.connect();
    }

    send(data) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(data);
        } else {
            console.error('WebSocket is not open. Ready state:', this.socket.readyState);
        }
    }
}
