export type CallbackFunction<T = any> = (err?: NodeJS.ErrnoException | null, result?: T) => void
