export default class StreamNotWritable extends Error {
    static message = "Stream isn't writeable and enableOfflineQueue options is false";

    constructor() {
        super(StreamNotWritable.message);
    }
}
