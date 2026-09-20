import { leaf } from "./leaf";

export function middle(): string {
	return `middle<-${leaf()}`;
}
