declare function Catch(): ClassDecorator;

@Catch()
export class AllExceptionsFilter {
	catch(
		exception: Error,
		host: { switchToHttp(): { getResponse(): unknown } },
	): void {
		const response = host.switchToHttp().getResponse() as {
			status(code: number): { json(body: unknown): void };
		};
		response.status(500).json({
			message: "boom",
			stack: exception.stack,
			cause: exception.stack,
		});
	}
}
