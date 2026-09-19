async function load(): Promise<void> {}
function wrapper(): void {
	function load(): void {}
	load();
}
load();
