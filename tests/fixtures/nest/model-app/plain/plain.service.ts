function Injectable(): ClassDecorator {
	return (target) => target;
}

@Injectable()
export class PlainService {}
