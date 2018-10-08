export interface IRedisOptions {
  [key: string]: any
}

export function getNodeKey(node: IRedisOptions): string {
  node.port = node.port || 6379
  node.host = node.host || '127.0.0.1'
  return node.host + ':' + node.port
}
