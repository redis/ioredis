export type CallbackFunction<T = void> = (err?: NodeJS.ErrnoException | null, result?: T) => void
