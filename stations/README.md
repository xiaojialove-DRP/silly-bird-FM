# stations —— 音乐存放处

每一张「唱片 / 电台」放一个子文件夹。把下载好的音频文件丢进去就行。

```
stations/
  xiaojia-late-night/         ← 一个 DJ 的一张唱片
    01 - Artist - Title.mp3
    02 - Artist - Title.flac
    ...
    station.json              ← 描述这张唱片（DJ、名字、顺序）
    cover.jpg                 ← 可选，整张唱片的封面
```

## 规则

- **格式**：mp3 / flac / m4a / wav 这类普通音频都行。
  > ⚠️ 网易云 VIP 下载有时是 `.ncm`（加密格式），播放器**放不了**——必须是普通音频文件。
- **顺序**：文件名前加 `01 ` `02 `… 来决定播放顺序（电台是有顺序的）。
- **元数据**：歌名 / 歌手 / 封面，App 会从文件内嵌标签（ID3）自动读，通常不用手填。
- **station.json**：给这张唱片起名、标注 DJ，必要时覆盖顺序或补缺失信息。复制 `_TEMPLATE/station.json` 改即可。

音频文件已在 `.gitignore` 里排除，不会进代码仓库——放心丢。
