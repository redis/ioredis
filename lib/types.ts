import {Socket} from 'net'
import {TLSSocket} from 'tls'

export type CallbackFunction<T = any> = (err?: NodeJS.ErrnoException | null, result?: T) => void
export type NetStream = Socket | TLSSocket

export interface ICommand {
  resolve(result: any): void
  reject(error: Error): void
}

export interface ICommandItem {
  command: ICommand
  stream: NetStream
  select: number
}
