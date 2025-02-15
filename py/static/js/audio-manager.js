class AudioManager {
  // These replace your useRef(...)
  private startTime: string;
  private wavRecorder: WavRecorder;
  private wavStreamPlayer: WavStreamPlayer;

  // Assume there's a client instance. (Equivalent to clientRef.current)
  private client: RealtimeClient | null = null;

  // If you had props in React, pass them in constructor or as separate config
  private initialMute: boolean;
  private enabled: boolean;

  constructor(options: { initialMute: boolean; enabled: boolean }) {
    // "useRef" replacements
    this.startTime = new Date().toISOString();
    this.wavRecorder = new WavRecorder({ sampleRate: 24000 });
    this.wavStreamPlayer = new WavStreamPlayer({
      sampleRate: 24000,
      initialMute: options.initialMute
    });

    this.initialMute = options.initialMute;
    this.enabled = options.enabled;
  }

  // If you had a function that sets up client websockets
  // (Equivalent to connectWebsockets)
  async connectWebsockets(): Promise<void> {
    // ... your logic to create or configure "this.client"
    // e.g. this.client = new RealtimeClient(...)
    // or fetch some token, etc.

    // For the sake of example:
    this.client = {
      sessionCreated: true,
      isConnected: true,
      appendInputAudio: (arrayBuffer: Float32Array) => {
        if (arrayBuffer.byteLength > 0) {
            this.realtime.send("input_audio_buffer.append", {audio: arrayBufferToBase64(arrayBuffer)});
            this.inputAudioBuffer = new Int16Array(0);
        }
      },
      sendUserMessageContent: async (content: any) => {
        if (content.length) {
          this.realtime.send("conversation.item.create", {item: {type: "message", role: "user", content}});
        }
        this.createResponse();
      },
      on: (event: string, handler: Function) => {
         /* TODO */
      },
      conversation: {
        getItems: () => {
            /* TODO: Get conversation items... */
            return []
        },
      },
      reset: () => {
        /* TODO: cleanup */
      },
      cancelResponse: async (trackId: string, offset: number) => {
         /* TODO: Cancel Response (truncate?) */
      },
    } as unknown as RealtimeClient;
  }

  // This replaces your `useCallback(() => { ... }, [connectWebsockets])`
  async connectAudio(): Promise<void> {
    // Make sure the client is ready (sessionCreated)
    if (!this.client?.sessionCreated) {
      await this.connectWebsockets();
    }

    // Start mic capture
    await this.wavRecorder.begin();

    // If no client, just bail
    if (!this.client) {
      console.error('No client');
      return;
    }

    // Start recording and feed data to client
    await this.wavRecorder.record(data => {
      this.client?.appendInputAudio(data.mono);
    });
  }

  // This replaces your `disconnect` useCallback
  async disconnect(): Promise<void> {
    if (!this.enabled) {
      return;
    }

    if (!this.client) {
      return;
    }

    // Stop recording and reset
    try {
      await this.wavRecorder.end();
      await this.wavStreamPlayer.interrupt();
    } catch (err) {
      console.log('Disconnected:', err);
    }
  }

  // This replaces your `submitText` useCallback
  async submitText(input: string): Promise<void> {
    if (!this.enabled) {
      console.log('Not enabled');
      return;
    }

    if (!this.client?.sessionCreated) {
      await this.connectWebsockets();
    }

    if (this.client?.isConnected) {
      await this.client.sendUserMessageContent([
        {
          type: 'input_text',
          text: input,
        },
      ]);
    } else {
      console.log('No client or not connected');
    }
  }

  // This method replaces your `useEffect` block
  // You can decide when/where to call it in your code
  // (e.g. constructor or after you know the client is set up)
  init() {
    if (this.enabled) {
      const client = this.client;

      if (!client) {
        console.log('No client, cannot init');
        return;
      }

      // Add event listeners
      client.on('error', (event: any) => console.error(event));
      client.on('conversation.interrupted', async () => {
        const trackSampleOffset = await this.wavStreamPlayer.interrupt();
        if (trackSampleOffset?.trackId) {
          const { trackId, offset } = trackSampleOffset;
          await client.cancelResponse(trackId, offset);
        }
      });
      client.on('conversation.updated', async ({ item, delta }: any) => {
        const items = client.conversation.getItems();
        if (delta?.audio) {
          this.wavStreamPlayer.add16BitPCM(delta.audio, item.id);
        }

        if (item.status === 'completed' && item.formatted.audio?.length) {
          // If you want to decode the wav data here, you could
          // const wavFile = await WavRecorder.decode(item.formatted.audio, 24000, 24000)
          // item.formatted.file = wavFile
        }

        // In React, you called setItems(items). Outside React,
        // you might store them in a variable, or update some UI, etc.
        console.log('Items updated: ', items);
      });

      // If you need a cleanup, you can define a separate method
      // or call client.reset() in a "destroy()" method.
    }
  }
}
