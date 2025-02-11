export default class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.socket = null;
    }

    connect() {
        this.socket = new io(this.url);

        // Bind Socket.IO event handlers
        this.socket.on('connect', (event) => this.handleOpen(event));
        // For receiving messages, Socket.IO typically uses custom events.
        // You might want to listen for a custom event name such as 'message' if your server sends it.
        this.socket.on('message', (data) => this.handleMessage({ data }));
        this.socket.on('error', (error) => this.handleError(error));
        this.socket.on('disconnect', (event) => this.handleClose(event));
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
