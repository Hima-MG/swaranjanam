export function unstable_rethrow() {}
export function redirect(url) {
  throw new Error(`redirect:${url}`);
}
export function notFound() {
  throw new Error("notFound");
}
