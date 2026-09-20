import axios from "axios";

export async function handler(req: { body: { target: string } }): Promise<unknown> {
	return axios.get(req.body.target);
}
