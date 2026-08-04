// ESM 桥接层：@pixi/utils（官方 SDK 栈内嵌 Pixi v7）的 url.mjs 以具名导入方式
// `import { parse, format, resolve } from "url"`，vite 会把 "url" 解析到 npm 的
// `url` polyfill（CJS，位于 soullink-emotion-sdk/node_modules），而 esbuild 预打包
// 只产出 default 导出，导致浏览器报 "does not provide an export named 'format'"。
// 此处基于浏览器原生 URL API 提供同签名实现（parse/format/resolve），绕过该缺陷。
//
// resolve() 踩坑记录（2026-08-04，Live2D "invalid moc data" 根因）：
// 旧实现 `new URL(to, from).href` 要求 from 必须是绝对 URL；而
// pixi-live2d-display（官方栈 cubism4）的 ModelSettings.resolveURL 传入的 from 是
// 相对路径（如 "/live2d/haru/Haru.model3.json"），new URL 会抛 "TypeError: Invalid URL"，
// catch 后仅返回 to 原始值（"Haru.moc3"），丢失目录前缀 → moc3 资源 URL 拼接错误 →
// 加载到错误地址 → isValidMoc（前 4 字节 != "MOC3"）失败 → "Invalid moc data"。
// 现改为兼容 node `url.resolve` 语义的纯字符串算法（RFC 3986 5.2.2 + 5.2.4）：
//   - from 为 null → 抛 TypeError；from 为空串 → 返回 to
//   - to 为绝对 URL（含 scheme）→ 直接返回 to
//   - to 以 "//" 开头 → base 的 scheme + to
//   - to 以 "/" 开头 → base 的 scheme+authority + to
//   - to 以 "?" 开头 → 保留 base 的 path，替换 query/hash
//   - to 以 "#" 开头 → 保留 base 的 path + base 的 query，替换 hash
//   - 其余 → base 目录 + to，并对路径做 ./ ../ 归一化
//
// 注意：项目业务代码不依赖 npm `url`，此 shim 仅为 Pixi v7 的 deprecated 工具而设。

function toURL(input, base) {
  if (input instanceof URL) return input;
  return new URL(String(input), base ?? "http://placeholder.invalid/");
}

/** legacy `url.parse(urlStr)` → 解析对象；失败返回 null（与原实现一致） */
export function parse(urlString, parseQueryString = false) {
  if (!urlString || typeof urlString !== "string") return null;
  try {
    const u = toURL(urlString, "http://placeholder.invalid/");
    const hasAuth = Boolean(u.username || u.password);
    const auth = hasAuth ? `${u.username}${u.password ? `:${u.password}` : ""}` : null;
    const search = u.search || "";
    return {
      protocol: u.protocol,
      slashes: u.protocol ? true : false,
      auth,
      host: u.host || null,
      port: u.port || null,
      hostname: u.hostname || null,
      hash: u.hash || null,
      search: search || null,
      query: search ? (parseQueryString ? parseQuery(search.slice(1)) : search.slice(1)) : null,
      pathname: u.pathname,
      path: u.pathname + search,
      href: u.href,
    };
  } catch {
    return null;
  }
}

function parseQuery(search) {
  const result = {};
  for (const pair of search.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const key = decodeURIComponent(idx >= 0 ? pair.slice(0, idx) : pair);
    const value = idx >= 0 ? decodeURIComponent(pair.slice(idx + 1)) : "";
    if (result[key] !== undefined) {
      if (Array.isArray(result[key])) result[key].push(value);
      else result[key] = [result[key], value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** legacy `url.format(urlObj)` → URL 字符串；兜底 String() */
export function format(urlObject) {
  if (!urlObject) return "";
  if (typeof urlObject === "string") return urlObject;
  if (urlObject instanceof URL) return urlObject.href;
  try {
    const u = toURL("http://placeholder.invalid/");
    if (urlObject.protocol) u.protocol = String(urlObject.protocol);
    if (urlObject.username) u.username = String(urlObject.username);
    if (urlObject.password) u.password = String(urlObject.password);
    if (urlObject.host) u.hostname = String(urlObject.host);
    if (urlObject.hostname) u.hostname = String(urlObject.hostname);
    if (urlObject.port) u.port = String(urlObject.port);
    if (urlObject.pathname) u.pathname = String(urlObject.pathname);
    if (urlObject.search) u.search = String(urlObject.search);
    if (urlObject.hash) u.hash = String(urlObject.hash);
    return u.href;
  } catch {
    return String(urlObject);
  }
}

/** RFC 3986 5.2.4 remove_dot_segments：移除 pathname 中的 ./ ../ 段（保留开头的 /） */
function removeDotSegments(path) {
  if (!path) return path;
  const input = path.split("/");
  const output = [];
  for (const segment of input) {
    if (segment === ".") continue;
    if (segment === "..") {
      output.pop(); // 空数组 pop 返回 undefined，无副作用
      continue;
    }
    output.push(segment);
  }
  let result = output.join("/");
  if (path.startsWith("/") && !result.startsWith("/")) result = "/" + result;
  return result;
}

/** legacy `url.resolve(from, to)` → 绝对 URL 字符串（兼容 node url.resolve 语义） */
export function resolve(from, to) {
  if (from == null) {
    throw new TypeError(`The \`url\` argument must be of type string. Received ${from}`);
  }
  const base = String(from);
  const target = String(to);
  if (base === "") return target;

  // to 为绝对 URL（含 scheme，如 "http://x/y"）→ 直接返回
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return target;

  // 拆解 base：scheme / authority / path / query+hash
  const baseMatch = /^(?:([a-zA-Z][a-zA-Z0-9+.-]*:))?(\/\/[^/?#]*)?([^?#]*)([\s\S]*)$/.exec(base);
  const baseScheme = baseMatch?.[1] ?? "";
  const baseAuthority = baseMatch?.[2] ?? "";
  const basePath = baseMatch?.[3] ?? "";
  const baseSuffix = baseMatch?.[4] ?? "";
  const baseQuery = baseSuffix.startsWith("?") ? baseSuffix.split("#")[0] : "";

  let outPath;
  let outSuffix = "";

  if (target.startsWith("//")) {
    // 协议相对：base 的 scheme + to
    return baseScheme + target;
  }

  if (target.startsWith("/")) {
    // 根相对：base 的 scheme+authority + to
    const qIdx = target.search(/[?#]/);
    outPath = removeDotSegments(qIdx >= 0 ? target.slice(0, qIdx) : target);
    outSuffix = qIdx >= 0 ? target.slice(qIdx) : "";
  } else if (target.startsWith("?")) {
    // 仅 query：保留 base path，替换 query/hash
    outPath = basePath;
    outSuffix = target;
  } else if (target.startsWith("#")) {
    // 仅 hash：保留 base path + base query，替换 hash
    outPath = basePath;
    outSuffix = baseQuery + target;
  } else {
    // 相对引用：base 目录 + target
    const slashIdx = basePath.lastIndexOf("/");
    const baseDir = slashIdx >= 0 ? basePath.slice(0, slashIdx + 1) : "";
    const qIdx = target.search(/[?#]/);
    const rel = qIdx >= 0 ? target.slice(0, qIdx) : target;
    outPath = removeDotSegments(baseDir + rel);
    outSuffix = qIdx >= 0 ? target.slice(qIdx) : "";
  }

  return baseScheme + baseAuthority + outPath + outSuffix;
}

export default { parse, format, resolve, URL, URLSearchParams };
