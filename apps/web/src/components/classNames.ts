export function classNames(styles: CSSModuleClasses): (...names: string[]) => string {
  return (...names) => names.map((name) => styles[name] ?? "").join(" ");
}
