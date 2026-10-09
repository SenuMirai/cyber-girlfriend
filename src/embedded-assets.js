// 打包成独立 exe 时，前端文件（index.html / style.css / app.js / 默认形象图）会被
// tools/build-exe.mjs 内嵌成 base64 写进这个模块，运行时不依赖外部文件。
// 源码模式（node server.mjs）下这里是空的，服务端会优先读磁盘上的真实文件，改完即生效。
export default {};
