// silly bird FM · 云端配置
// url/anonKey 是 Supabase 的 "anon / publishable" 公开钥匙——按 Supabase 的设计，
// 这把钥匙本就可以出现在公开的前端代码里；真正的权限边界是后台的 RLS 策略
// （这个项目只放行了 insert，不能读取文件列表、不能删改）。别把 service_role/secret
// 钥匙放进这个文件。
window.SBFM_CLOUD = {
  url: "https://exxdcsnmbphbuyxcqqgp.supabase.co",
  anonKey: "sb_publishable_5-hIJbu64kpQN7VzQz8-Tg_a0W_vNgl",
  bucket: "stations",
};
