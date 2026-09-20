import { serveB } from "./b";

export function serveA(): string {
	return `a<-${serveB()}`;
}
