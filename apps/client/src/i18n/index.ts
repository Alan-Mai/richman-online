import { zhTW } from './zh-TW';

export type MessageKey = keyof typeof zhTW;

/** Names of the {placeholders} in a message, as a union of string literals. */
type ParamNames<S extends string> = S extends `${string}{${infer P}}${infer Rest}`
  ? P | ParamNames<Rest>
  : never;

type ParamsFor<K extends MessageKey> = Record<ParamNames<(typeof zhTW)[K]>, string | number>;

/** Messages without placeholders take no params; the others require every one of them. */
type ParamArgs<K extends MessageKey> = [ParamNames<(typeof zhTW)[K]>] extends [never]
  ? []
  : [params: ParamsFor<K>];

/**
 * Looks up a message and fills in its placeholders. A placeholder without a value (only possible
 * through a cast) is left as written, so the gap shows on screen instead of crashing.
 */
export function t<K extends MessageKey>(key: K, ...args: ParamArgs<K>): string {
  const params: Record<string, string | number> = args[0] ?? {};
  return zhTW[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = params[name];
    return value === undefined ? placeholder : String(value);
  });
}

const moneyFormat = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });

/** Money as shown to players, with thousands separators. */
export function formatMoney(amount: number): string {
  return moneyFormat.format(amount);
}
