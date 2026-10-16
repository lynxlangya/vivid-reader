export interface Position {
  readonly cfi: string;
  toString(): string;
}
export interface PositionCodec {
  compare(a: Position, b: Position): number;
  fromString(value: string): Position;
  toString(position: Position): string;
}
