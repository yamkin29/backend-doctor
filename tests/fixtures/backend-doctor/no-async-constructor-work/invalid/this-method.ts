class Server {
	private ready = false;
	async start(): Promise<void> {
		this.ready = true;
	}
	constructor() {
		this.start();
	}
}
