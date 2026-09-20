function Module(..._args: unknown[]): ClassDecorator {
	return (target) => target;
}

@Module({})
export class PlainModule {}
