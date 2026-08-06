// ---- i18n: the app's own copy, in both languages, plus the lookup ----
// Split out of main.js purely because it is bulk data, not behaviour: ~120 lines of
// dictionary sitting above the logic meant scrolling past it to reach anything real.
//
// Scope is deliberate and narrow. This translates strings THIS APP wrote — labels,
// status messages, the three demo channels. It never touches a real station name,
// intro or track title, and never a guest's shared content: those are someone's own
// words, not ours to translate.
//
// `lang` is exported as a live binding, so importers always read the current value;
// setLangValue() is the only way to change it. Everything that re-renders on a
// language switch stays in main.js, because it is all DOM work.
//
// lang resolves synchronously on import, so it is ready before main.js builds the
// demo stations for their first render.
export const I18N = {
  zh: {
    openApp: "打开 silly bird fm", lookVolume: "外观与音量", collapseToBird: "收回成小鸟",
    aboutInfo: "这是什么 · 怎么玩",
    dropHint: "松手 · 放进小鸟的电台 ♪", openMyStation: "打开我的电台",
    newContent: "有新内容",
    myStation: "我的电台", me: "我", close: "关闭",
    stationName: "电台名", stationNamePlaceholder: "比如：小加的夏日降噪电台",
    stationIntro: "一句话介绍", stationIntroPlaceholder: "比如：睡不着的夜里，说给你听",
    programs: "节目", programsCount: (n, max) => `节目 · ${n}/${max}`,
    uploadAudio: "⊕ 上传音频", holdToRecord: "● 按住录音", releaseToFinish: "松开完成",
    done: "完成", shareLatest: "✉ 把最新的声音分享出去", copyLinkAbove: "复制以上链接",
    look: "外观", interfaceColor: "界面颜色 · 你的偏好", volume: "音量",
    about: "这是什么",
    aboutBody1: "一个朋友之间的声音电台。",
    aboutBody2: "◁▷ 调台，能听到不同朋友的频道；调到你自己的空位，就能建一个属于你的电台，发链接给朋友听。",
    aboutDownload: "↓ 下载桌面版（macOS）",
    share: "分享", backToStation: "‹ 我的电台", generateShareLink: "✉ 生成分享链接",
    yourLink: "链接如下 · 每次编辑后再点一次「把最新的声音分享出去」即可更新",
    // shareTtlLabel is the select's aria-label only now — its own option list
    // (index.html) needs "永久" to read as a plain, parallel 4th duration
    // alongside 1/7/30 days, not an instruction standing in the same slot
    shareTtlLabel: "撤回分享 · 你可以设置有效期",
    shareTtlForever: "永久", shareTtl1d: "1 天", shareTtl7d: "7 天", shareTtl30d: "1 个月",
    sendStamp: "给朋友寄个回执吧。", stampsReceived: "收到的邮票",
    trackName: "节目名称", trackTag: "节目标签（可选）", remove: "移除",
    colorCrimson: "绛红", colorRust: "赤陶", colorOchre: "蜜赭", colorGreen: "墨绿",
    colorBlue: "蓝", colorPlum: "梅紫", colorBlack: "黑",

    noProgramsYet: "还没有节目", tapAboveToCreate: "点上面创建电台",
    inviteMakeYourOwn: "＋ 邀请你也做一个自己的电台", tuneListenFriend: "◁ ▷ 先听听朋友的电台",
    stationFull: (n) => `电台已经满了（最多 ${n} 首）· 删掉一首再加新的`,
    stationFullRecord: (n) => `电台已经满了（最多 ${n} 首）· 删掉一首再录新的`,
    stationFullTrim: (n, used) => `电台最多 ${n} 首 · 这次加了前 ${used} 首，其余没加`,
    dropOrUploadFirst: "先拖入或上传至少一段声音",
    saveFailed: "这首没能存到本地 · 现在能听，但刷新后会消失",
    restoreFromLink: "↺ 从我自己的分享链接恢复",
    restoreDo: "↺ 恢复到这台设备",
    restorePlaceholder: "粘贴你之前发出去的那条链接",
    restoreBadLink: "这不像是一条分享链接 · 把你发给朋友的那条整个粘进来就行",
    restoring: (i, n) => `正在取回 ${i} / ${n} …`,
    restoredNeedsNewLink: "取回来了 · 节目已经存到这台设备上。这条旧链接改不动了，编辑完点「生成分享链接」会给你一条新的，发给朋友即可",
    restoreFailed: "没能取回来 · 检查一下网络，或者稍后再试",
    saveFailedFull: "设备存储空间不够，这首没能存下来 · 现在能听，但刷新后会消失。删掉一两首再试试",
    saveFailedNoStorage: "这个浏览器不让本站存东西（多半是隐私模式）· 现在能听、也能分享出去，但刷新后节目会消失",
    cloudNotConfigured: "还没配置云端 · 打开 src/main.js 顶部 CLOUD，照 README「分享」两分钟填好",
    uploading: (i, n) => `上传中 ${i} / ${n} …`,
    shareUpdated: "已更新 · 之前发过的链接会自动显示最新内容",
    shareCopied: "已复制 · 粘贴发给朋友就是一张分享卡",
    copyFailedLinkBelow: "复制失败 · 链接就在下面，手动复制发给朋友",
    uploadFailedNetwork: "上传失败：连不上云端服务器。Supabase 是海外服务，国内网络偶尔连不稳——挂个 VPN 再点一次「把最新的声音分享出去」试试；已经开着 VPN 的话，换个节点再试一次。",
    uploadFailed: "这次没能生成链接，可以再试一次",
    uploadFailedKeepOld: "这次的修改没有发布出去 · 朋友打开看到的还是上一次成功分享的内容",
    cannotSignIn: "暂时没能连上账号服务，所以这次没有发布出去 · 过一会儿再试一次就好",
    publishedButUnverified: "上传完成了，但回读检查没通过 · 朋友现在打开可能还是旧的，过一会儿再点一次「把最新的声音分享出去」",
    shareNotYours: "这条链接已经不认得这个浏览器了（清过网站数据、或换过设备），所以改不动它 · 你这次的修改没有发布出去，本地记录已经清除，再点一次「把最新的声音分享出去」会是一条全新的链接。",
    waitingForYou: "在等你收听",
    cloudDeleteBlocked: "云端拒绝了删除（缺少 delete 权限策略）",
    untitled: "未命名", friendsStation: "朋友的电台", friend: "朋友", tuningIn: "调台中…",
    guestLoadFailedTitle: "连不上朋友的电台",
    guestLoadFailedNetwork: "网络不太稳，可能需要 VPN——刷新页面再试一次",
    guestLoadFailed: "这条链接好像已经失效了",
    guestExpiredTitle: "这段声音已经消失了",
    guestExpired: "录的人把它设成了会自己消失，现在已经到时间了。",
    addTag: "＋ 标签", copied: "✓ 已复制", copyFailedSelect: "复制失败，请手动选中上面的链接",
    saved: "✓ 已保存", micDenied: "没能打开麦克风 · 请检查浏览器/系统的麦克风权限",
    recordingTitle: (m, d, h, mi) => `录音 ${m}-${d} ${h}:${mi}`,

    demo1Name: "深夜胡思乱想", demo1Owner: "小佳", demo1Intro: "睡不着的夜里，说给你听",
    demo1T1: "写代码写到凌晨三点", demo1T2: "最近单曲循环，哼给你听", demo1T3: "楼下便利店的白噪音",
    demo2Name: "雨天限定", demo2Owner: "Wren", demo2Intro: "只在下雨天更新",
    demo2T1: "阳台上的一整场雨", demo2T2: "读了一段《海边的卡夫卡》",
    demo3Name: "厨房迪斯科", demo3Owner: "Pomelo", demo3Intro: "一边做饭一边跳舞",
    demo3T1: "边做饭边乱唱", demo3T2: "今天菜市场好热闹",
  },
  en: {
    openApp: "Open silly bird fm", lookVolume: "Look & volume", collapseToBird: "Collapse to bird",
    aboutInfo: "What is this · how to play",
    dropHint: "Let go · into the bird's station ♪", openMyStation: "Open my station",
    newContent: "New since you last listened",
    myStation: "My Station", me: "Me", close: "Close",
    stationName: "Station name", stationNamePlaceholder: "e.g. Xiaojia's Summer Hush",
    stationIntro: "One-line intro", stationIntroPlaceholder: "e.g. Can't sleep, telling you about it",
    programs: "Programs", programsCount: (n, max) => `Programs · ${n}/${max}`,
    uploadAudio: "⊕ Upload audio", holdToRecord: "● Hold to record", releaseToFinish: "Release when done",
    done: "Done", shareLatest: "✉ Share your latest sound", copyLinkAbove: "Copy the link above",
    look: "Look", interfaceColor: "Interface color · your preference", volume: "Volume",
    about: "About",
    aboutBody1: "A sound radio between friends.",
    aboutBody2: "◁▷ tune the dial to hear different friends' channels; tune to your own empty slot to start your own station and share the link with a friend.",
    aboutDownload: "↓ Download for macOS",
    share: "Share", backToStation: "‹ My Station", generateShareLink: "✉ Generate share link",
    yourLink: "Your link is below · edit anytime, then click Share your latest sound again to update it",
    // shareTtlLabel is the select's aria-label only now — its own option list
    // (index.html) needs "Forever" to read as a plain, parallel 4th duration
    // alongside 1/7/30 days, not an instruction standing in the same slot
    shareTtlLabel: "Revoke share · you can set an expiry",
    shareTtlForever: "Forever", shareTtl1d: "1 day", shareTtl7d: "7 days", shareTtl30d: "1 month",
    sendStamp: "Send your friend a receipt", stampsReceived: "Stamps received",
    trackName: "Track name", trackTag: "Track tag (optional)", remove: "Remove",
    colorCrimson: "Crimson", colorRust: "Rust", colorOchre: "Ochre", colorGreen: "Forest green",
    colorBlue: "Blue", colorPlum: "Plum", colorBlack: "Black",

    noProgramsYet: "No programs yet", tapAboveToCreate: "Tap above to create your station",
    inviteMakeYourOwn: "＋ Make one of your own", tuneListenFriend: "◁ ▷ Listen to a friend's station first",
    stationFull: (n) => `Station's full (max ${n}) · remove one to add another`,
    stationFullRecord: (n) => `Station's full (max ${n}) · remove one to record another`,
    stationFullTrim: (n, used) => `Max ${n} tracks per station · added the first ${used} this time, the rest didn't fit`,
    dropOrUploadFirst: "Drop in or upload at least one sound first",
    saveFailed: "This one was not saved locally · it plays now, but a reload loses it",
    restoreFromLink: "↺ Restore from my own share link",
    restoreDo: "↺ Restore it to this device",
    restorePlaceholder: "Paste the link you sent out",
    restoreBadLink: "That does not look like a share link · paste the whole one you sent a friend",
    restoring: (i, n) => `Fetching ${i} / ${n} …`,
    restoredNeedsNewLink: "Got it back · the programs are saved on this device now. The old link cannot be edited from here, so when you are done editing, Generate share link gives you a fresh one to send",
    restoreFailed: "Could not fetch it back · check the connection, or try again in a moment",
    saveFailedFull: "Not enough room on this device to save it · it plays now, but a reload loses it. Try removing a track or two",
    saveFailedNoStorage: "This browser will not let the site store anything (usually private browsing) · you can listen and share, but a reload loses your programs",
    cloudNotConfigured: "Cloud isn't set up yet · open CLOUD at the top of src/main.js and follow the README's Sharing section, two minutes",
    uploading: (i, n) => `Uploading ${i} / ${n} …`,
    shareUpdated: "Updated · the link you already sent now shows the latest",
    shareCopied: "Copied · paste it to a friend and it's a share card",
    copyFailedLinkBelow: "Copy failed · the link is right below, copy it manually to send",
    uploadFailedNetwork: "Upload failed: can't reach the cloud server. Supabase is hosted overseas, so this can be flaky on some networks — try a VPN and click Share your latest sound again; if you're already on one, try a different node.",
    uploadFailed: "Could not generate the link this time — feel free to try again",
    uploadFailedKeepOld: "These edits were not published · your friend still sees whatever you last shared successfully",
    cannotSignIn: "Could not reach the sign-in service just now, so nothing was published · try again in a moment",
    publishedButUnverified: "Uploaded, but reading the link back did not match · a friend opening it now may still get the old version. Give it a moment and click Share your latest sound again.",
    shareNotYours: "This link no longer recognizes this browser (site data cleared, or a different device), so it cannot be edited · your changes were not published, and the local record has been cleared — click Share your latest sound again for a brand new link.",
    waitingForYou: "is waiting for you to listen",
    cloudDeleteBlocked: "Cloud rejected the delete (missing a delete policy)",
    untitled: "Untitled", friendsStation: "A friend's station", friend: "a friend", tuningIn: "Tuning in…",
    guestLoadFailedTitle: "Can't reach your friend's station",
    guestLoadFailedNetwork: "Connection trouble — this might need a VPN. Refresh and try again.",
    guestLoadFailed: "This link doesn't seem to work anymore",
    guestExpiredTitle: "This sound has already disappeared",
    guestExpired: "Whoever recorded it set it to fade on its own, and the time's already passed.",
    addTag: "+ Tag", copied: "✓ Copied", copyFailedSelect: "Copy failed, please select the link above manually",
    saved: "✓ Saved", micDenied: "Couldn't open the mic · check your browser/system mic permission",
    recordingTitle: (m, d, h, mi) => `Recording ${m}/${d} ${h}:${mi}`,

    demo1Name: "Late Night Overthinking", demo1Owner: "Xiaojia", demo1Intro: "Wide awake, and you're who I'm telling",
    demo1T1: "Coding till 3am", demo1T2: "The song stuck in my head, hummed for you", demo1T3: "White noise from the corner store",
    demo2Name: "Rainy Days Only", demo2Owner: "Wren", demo2Intro: "Only updates when it rains",
    demo2T1: "A whole rainstorm from the balcony", demo2T2: "Read a bit of Kafka on the Shore",
    demo3Name: "Kitchen Disco", demo3Owner: "Pomelo", demo3Intro: "Dancing while dinner cooks",
    demo3T1: "Singing badly while cooking", demo3T2: "The market was lively today",
  },
};
export let lang = "en";
try { lang = localStorage.getItem("sbfm-lang") === "zh" ? "zh" : "en"; } catch {}
export function t(key, ...args) {
  const entry = (I18N[lang] && I18N[lang][key] !== undefined) ? I18N[lang][key] : I18N.zh[key];
  return typeof entry === "function" ? entry(...args) : entry;
}

export function setLangValue(l) {
  lang = l === "en" ? "en" : "zh";
  try { localStorage.setItem("sbfm-lang", lang); } catch {}
  return lang;
}

