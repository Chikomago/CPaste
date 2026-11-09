type Language = 'zh-CN' | 'en-US';
let current: Language = 'zh-CN';
export function setLanguage(language: Language) {
  current = language;
  document.documentElement.lang = language;
}
export function isEnglish() { return current === 'en-US'; }
const english: Record<string, string> = {
  '共 {count} 条':'{count} items',
  '开发版不安装更新，请使用正式安装包':'Updates cannot be installed in a development build. Use an installed release.', '请先检查更新':'Check for updates first', '更新尚未安装':'The update has not been installed',
  '关于':'About','版本':'Version','作者':'Author','项目地址':'Project','协议':'License',
  '自动检查更新':'Check for updates automatically','启动后及每 6 小时检查，安装前由你确认':'Check on startup and every 6 hours. Ask before installing.',
  '检查更新':'Check for updates','正在检查…':'Checking…','已是最新版本':'Up to date','发现新版本':'Update available','正在下载…':'Downloading…','正在安装…':'Installing…','更新已安装，重启后生效':'Update installed. Restart to apply.',
  '更新未完成':'Update incomplete','重启应用':'Restart app','下载并安装':'Download and install','下载进度':'Download progress','更新说明':'Release notes',
  '可重新检查更新，或到项目地址下载安装包。':'Check again, or download an installer from the project page.',
  '发现新版本，请到设置 → 关于更新':'An update is available. Open Settings → About to install.',

  '组词区域':'Combined text',
  '通用词典':'General dictionary','使用通用词典':'Use general dictionary','未下载':'Not downloaded','已下载':'Downloaded','约 5 MB':'About 5 MB','下载词典':'Download dictionary','重新下载':'Download again','下载中…':'Downloading…','正在校验…':'Verifying…','词典校验失败，请重新下载':'Dictionary verification failed. Download it again.','词典正在下载':'The dictionary is already downloading',
  '支持 .txt 和 .dict 导入':'Import .txt and .dict files',
  '支持每行一个词，或 jieba 格式：词语 词频 [词性]。词频和词性可省略，仅首列词语会被读取。':'Use one word per line, or jieba format: word frequency [tag]. Frequency and tag are optional; only the first column is read.',
  '空行和 # 开头的注释会跳过；重复词条自动去重。':'Blank lines and comments starting with # are skipped. Duplicate words are removed.',
  '支持 UTF-8 TXT／DICT，单个文件最多 50 MB，合并后最多 50 万词条／50 MB。':'Supports UTF-8 TXT/DICT files up to 50 MB; merged imports support up to 500,000 words / 50 MB.',
  '导入后自动保存并合并去重，不覆盖已有词条。大词典独立存储，不载入下方编辑框。':'Imports are saved automatically and merged without duplicates. Large dictionaries are stored separately, outside the editor below.',
  '下方可补充词条，每行一个词；兼容“词语 词频 词性”格式。':'Add extra words below, one per line. Jieba word-frequency-tag lines are also accepted.',
  '已导入词典':'Imported dictionary','个词条':'words','正在处理词典…':'Processing dictionary…','词典不能超过 50 MB':'The dictionary must be under 50 MB','自定义词典最多支持 50 万个词条':'Custom dictionaries support up to 500,000 words','合并后的词典不能超过 50 MB':'The merged dictionary must be under 50 MB','词典中没有可导入的词条':'The file contains no words to import',
  '内置词典':'Built-in dictionary','使用 jieba-rs 内置中文词典，本机离线分词':'Use the bundled jieba-rs Chinese dictionary offline','自定义词典':'Custom dictionary','自定义词条':'Custom words','自定义词条优先于内置词典，同时用于条目和搜索分词':'Custom words take priority for both items and search','关闭内置词典后，仅使用自定义词条，未收录的汉字会逐字拆分。':'With the built-in dictionary off, only custom words are used. Unknown Chinese text is split into individual characters.','每行一个词，兼容“词语 词频 词性”格式。导入后点击保存词典。':'Enter one word per line. Jieba word-frequency-tag lines are also accepted. Save after importing.','最多 5000 个词条，文件需为 UTF-8 编码，不超过 1 MB。':'Up to 5,000 words. Import UTF-8 text files under 1 MB.','导入词典':'Import dictionary','保存词典':'Save dictionary','关闭分词':'Close word splitting','正在分词…':'Splitting text…','搜索分词失败':'Search segmentation failed','点击词块，直接粘贴到原输入位置':'Click a word to paste at the original cursor position','词典不能超过 1 MB':'The dictionary must be under 1 MB','每个词条不能超过 200 个字符':'Each word must be under 200 characters','自定义词典最多支持 5000 个词条':'Custom dictionaries support up to 5,000 words','无法读取词典，请使用 UTF-8 编码的文本文件':'Cannot read the dictionary. Use a UTF-8 text file.','分词内容不能超过 1 MB':'Text must be under 1 MB',
  '分词':'Split into words','全选':'Select all','清除选择':'Clear selection','点选词块，按原文顺序组合':'Select words to combine them in their original order','组合结果':'Combined text','选择词块后在这里预览':'Select words to preview the result','显示更多':'Show more','请选择词块，组合内容不能超过 1 MB':'Select words. The combined text must be under 1 MB.','这条记录不支持分词':'This item cannot be split into words','敏感内容已遮盖，无法分词':'Masked sensitive content cannot be split into words',
  '置顶和收藏的记录不自动清理。':'Pinned and favorite items are kept during automatic cleanup.',
  '开启后不记录从该应用复制的内容。':'Turn on an app to exclude content copied from it.',
  '用于粘贴到其他应用所需权限':'Allows pasting into other apps',
  '切换主题外观':'Choose a theme',
  '界面主色调':'Choose the interface accent color',
  '跟随光标显示剪贴板预览卡片':'Show a clipboard preview when hovering over an item',
  '呼出面板时显默认展示分类':'Category shown when the panel opens',
  '打开主面板':'Open main panel',
  '清空所有记录':'Clear all history','删除全部记录，包括置顶和收藏':'Delete all items, including pinned and favorite items','将删除全部剪贴板记录，包括置顶和收藏，无法恢复。设置和系统剪贴板不受影响。':'All history, including pinned and favorite items, will be permanently deleted. Settings and the system clipboard are kept.',
  '全部':'All','文本':'Text','纯文本':'Plain text','富文本':'Rich text','图片':'Image','文件':'Files','代码':'Code','收藏':'Favorites',
  '粘贴':'Paste','粘贴为纯文本／文件路径':'Paste plain text / paths','粘贴原格式':'Paste original format','复制':'Copy','复制为纯文本／文件路径':'Copy plain text / paths','复制原格式':'Copy original format','预览内容':'Preview','编辑内容':'Edit content','记录内容':'Item content','保存后转为纯文本，原格式会丢失。':'Saving converts this item to plain text and removes its formatting.','内容不能为空':'Content cannot be empty','内容不能超过 1 MB':'Content must be under 1 MB','取消':'Cancel','保存':'Save','创建时间':'Creation time','使用频率':'Usage frequency','修改时间':'Modified time','收藏／取消收藏':'Toggle favorite','置顶／取消置顶':'Toggle pin','删除记录':'Delete item',
  '刚刚':'Just now','未知应用':'Unknown app','图片缩略图':'Image thumbnail','图片预览不可用':'Image preview unavailable','尺寸不可用':'Dimensions unavailable','大小不可用':'Size unavailable','此记录没有纯文本预览':'No plain text preview','剪贴板图片预览':'Clipboard image preview',
  '界面':'Interface','展示位置':'Panel position','设置':'Settings','外观':'Appearance','快捷键':'Shortcuts','行为':'Behavior','粘贴行为':'Paste','复制行为':'Copy','采集类型':'Capture types','存储':'Storage','隐私':'Privacy','系统权限':'System permissions','启动与显示':'Startup & display','备份':'Backup',
  '语言':'Language','中文':'Chinese','空格':'Space','切换界面语言':'Choose the interface language','主题':'Theme','跟随电脑外观，或手动选择':'Follow your computer appearance or choose a theme','跟随系统':'System','浅色':'Light','深色':'Dark','主题色':'Accent color','按钮使用深色，选中区域自动淡化':'Buttons use a strong accent; selected areas use a softer shade','内容预览':'Content preview','显示来源应用图标':'Show source app icons','在记录条目中显示复制来源的应用图标':'Show the source app icon on each item','居中或跟随光标时自动显示；四侧面板可手动预览':'Automatically preview in center or cursor mode; preview manually at screen edges',
  '粘贴后回到顶部':'Return to top after pasting','粘贴后将记录列表滚回顶部':'Scroll the list to the top after pasting','条目最大显示行数':'Maximum lines per item','超过设定行数的内容会省略':'Longer content is truncated','默认打开分类':'Open to','呼出面板时显示的分类':'Category shown when the panel opens',
  '打开选择面板':'Open picker','打开选择面板的快捷键':'Shortcut to open picker','点击输入框后按下组合键；Esc 取消':'Click the field and press a shortcut; Esc cancels','快捷键呼出位置':'Picker position','选择面板出现的位置和样式':'Choose where the picker appears','跟随光标':'Follow cursor','屏幕中间':'Screen center','屏幕左侧':'Left edge','屏幕右侧':'Right edge','屏幕顶部':'Top edge','屏幕底部':'Bottom edge','卡片列数':'Card columns','左侧和右侧面板使用':'Used for left and right layouts','一列':'One','两列':'Two','记录操作':'Item actions','仅在选择面板中生效。点击录入；Esc 取消。清除后停用。':'Works in the picker. Click to record; Esc cancels. Clear to disable.','未设置':'Not set','清除快捷键':'Clear shortcut','请按下快捷键…':'Press a shortcut…','请按下组合键…':'Press a shortcut…',
  '粘贴后关闭面板':'Close picker after pasting','完成粘贴后收起选择面板':'Hide the picker after pasting','默认粘贴为纯文本':'Paste plain text by default','默认粘贴文件路径':'Paste file paths by default','默认复制为纯文本':'Copy plain text by default','默认复制文件路径':'Copy file paths by default','文本和富文本记录不带格式；图片不受影响':'Remove formatting from text and rich text; images are unchanged','文件记录粘贴为路径文字；关闭后粘贴文件':'Paste file paths as text; turn off to paste files','文件记录复制为路径文字；关闭后复制文件':'Copy file paths as text; turn off to copy files','点击粘贴':'Click to paste','选择记录时如何粘贴':'Choose how to paste an item','单击':'Single click','双击':'Double click',
  '选择要保存的剪贴板类型。':'Choose which clipboard types to save.','保留天数':'Keep for days','最多条数':'Maximum items','存储上限（MB）':'Storage limit (MB)','设为 0 则不按时间清理':'Set to 0 to disable age cleanup','设为 0 则不限制条数':'Set to 0 for no item limit','设为 0 则不限制容量':'Set to 0 for no size limit','达到已设置的上限后清理较早记录。置顶和收藏的记录不自动清理。':'Older items are removed at the limits. Pinned and favorite items are kept.','无限制':'Unlimited',
  '敏感内容':'Sensitive content','识别密钥、令牌和密码字段':'Detect keys, tokens, and password fields','保存并遮盖':'Save and mask','不加入历史':'Exclude from history','正常保存':'Save normally','敏感内容处理方式':'Sensitive content handling','遮盖会应用到已有记录；粘贴仍使用原内容。“不加入历史”只影响之后复制的内容。':'Masking also applies to existing items. Pasting uses the original content. Exclusion affects future copies.','来源应用黑名单':'Excluded source apps','打开开关后，不记录从该应用复制的内容。':'Turn on an app to stop saving content copied from it.','搜索应用':'Search apps','搜索本机应用':'Search installed apps','未读取到本机应用。重新打开设置后再试。':'Could not load installed apps. Reopen Settings to try again.',
  '辅助功能':'Accessibility','用于将历史记录直接粘贴到其他应用':'Allows direct pasting into other apps','已开启':'Enabled','去开启':'Enable','完全磁盘访问':'Full Disk Access','需在系统设置中手动开启':'Enable manually in System Settings','打开系统设置':'Open System Settings','开启后返回此处，状态会自动刷新。':'Return here after enabling it. The status refreshes automatically.','Windows 无需单独开启这两项权限。':'Windows does not require these permissions.',
  '在菜单栏／托盘显示':'Show in menu bar / tray','关闭后仍可用快捷键打开面板':'The shortcut still opens the picker','在 Dock 显示':'Show in Dock','关闭后仍可用快捷键呼出面板':'The shortcut still opens the picker','开机启动':'Launch at login','登录电脑后开始后台记录':'Start capturing when you sign in',
  '备份文件包含记录、图片和设置。':'Backups include items, images, and settings.','备份到文件':'Back up to file','从文件恢复':'Restore from file','恢复备份会覆盖当前所有记录和设置，无法撤销。确定继续吗？':'Restoring will replace all current items and settings. This cannot be undone. Continue?',
  '搜索':'Search','搜索剪贴板记录':'Search clipboard history','清除搜索':'Clear search','记录排序':'Sort items','最新':'Newest','最早':'Oldest','窗口置顶':'Keep window open','取消窗口置顶':'Stop keeping window open','打开设置':'Open Settings','置顶记录':'Pinned items','没有匹配的记录':'No matching items','还没有记录':'No items yet','换个关键词或类型试试':'Try another keyword or type','复制内容后会显示在这里':'Copied content will appear here','选择记录以预览内容':'Select an item to preview','预览加载中':'Loading preview','拖动面板边缘调整大小':'Drag to resize panel','关闭提示':'Dismiss message','关闭设置':'Close Settings','设置分类':'Settings categories','删除':'Delete','置顶':'Pin','取消置顶':'Unpin','取消收藏':'Remove favorite','已复制':'Copied','已放入剪贴板，可手动粘贴':'Copied to clipboard. Paste manually.','备份已保存':'Backup saved','备份已恢复':'Backup restored','删除这条记录？删除后无法恢复。':'Delete this item? It cannot be restored.'
};
export function tr(text: string) { return current === 'en-US' ? english[text] ?? text : text; }
const errorPrefixes: Record<string, string> = {
  '词典下载失败':'Dictionary download failed',
  '记录读取失败':'Could not load items','面板无法打开':'Could not open picker','预览无法打开':'Could not open preview','预览窗口无法调整':'Could not resize preview','预览读取失败':'Could not load preview','操作未完成':'Action failed','粘贴失败':'Could not paste','菜单无法打开':'Could not open menu','面板尺寸调整失败':'Could not resize picker','面板尺寸未保存':'Could not save picker size','窗口置顶失败':'Could not keep window open','设置无法打开':'Could not open Settings','设置读取失败':'Could not load settings','设置未保存':'Could not save settings','备份失败':'Backup failed','恢复失败':'Restore failed','无法请求辅助功能权限':'Could not request Accessibility','无法打开系统设置':'Could not open System Settings'
};
export function trNotice(text: string) {
  if (current !== 'en-US') return text;
  const split = text.indexOf('：');
  return split < 0 ? tr(text) : `${errorPrefixes[text.slice(0, split)] || tr(text.slice(0, split))}: ${text.slice(split + 1)}`;
}
