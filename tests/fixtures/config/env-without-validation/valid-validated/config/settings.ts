import { z } from "zod";

const schema = z.object({
	port: z.coerce.number(),
});

export const settings = schema.parse({
	port: process.env.PORT,
});
