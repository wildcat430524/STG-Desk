// Application UI localization.
//
// One explicit dictionary for every piece of application chrome. Chinese is the
// default and English is opt-in. Nothing here touches document content, Markdown,
// file names, provider/model names or saved learning records: callers only ask
// for a key, so a translation can never rewrite user text.
//
// The module is deliberately DOM-free at import time so the dictionary, key
// parity, interpolation and preference logic can be unit tested in plain Node.

export const DEFAULT_LOCALE = 'zh-CN';
export const LOCALES = ['zh-CN', 'en'];
export const STORAGE_KEY = 'stg-app-language';

// Keys are grouped by surface. {name} placeholders are interpolated by t().
// Keep zh/en in the same order so a missing translation is obvious in review.
export const MESSAGES = {
  'app.title': { zh: 'STG Desk · 学习工作台', en: 'STG Desk · Learning Workspace' },
  'app.nativeSubtitle': { zh: '学习工作台', en: 'Learning Workspace' },
  'app.dshWindowTitle': { zh: 'DSH · 当前会话', en: 'DSH · Current session' },
  'brand.tagline': { zh: '每一步，都更进一步', en: 'A step further, every step' },

  'language.label': { zh: '界面语言', en: 'Interface language' },
  'language.zh': { zh: '中文', en: '中文' },
  'language.en': { zh: 'English', en: 'English' },
  'theme.night': { zh: '夜间', en: 'Night' },
  'theme.day': { zh: '日间', en: 'Day' },
  'theme.toggleAria': { zh: '切换全局夜间模式', en: 'Toggle dark mode' },

  'common.cancel': { zh: '取消', en: 'Cancel' },
  'common.close': { zh: '关闭', en: 'Close' },
  'common.edit': { zh: '编辑', en: 'Edit' },
  'common.preview': { zh: '预览', en: 'Preview' },
  'common.insert': { zh: '插入', en: 'Insert' },
  'common.apply': { zh: '应用', en: 'Apply' },

  'header.import': { zh: '导入学习文件夹', en: 'Import learning folder' },
  'header.workspaceEyebrow': { zh: '当前工作区', en: 'Current workspace' },
  'header.noWorkspace': { zh: '尚未导入文件夹', en: 'No folder imported yet' },
  'header.workspaceMeta': { zh: '支持 StepsToGreat 与普通 Markdown', en: 'Works with StepsToGreat and plain Markdown' },
  'header.openDsh': { zh: '打开 DSH', en: 'Open DSH' },
  'header.openDshTitle': { zh: '打开 DSH 对话', en: 'Open the DSH chat' },
  'header.continue': { zh: '继续学习', en: 'Continue learning' },
  'header.chooseCourse': { zh: '课程与文档', en: 'Lessons & documents' },
  'header.localFirst': { zh: '本地优先', en: 'Local first' },
  'header.refreshTitle': { zh: '刷新当前文档和学习进度', en: 'Refresh the current document and progress' },
  'header.pages': { zh: '学习页面', en: 'Learning pages' },
  'header.pagesAria': { zh: '教学、回答和进度页面', en: 'Teaching, answers, and progress pages' },
  'header.emptyDocs': { zh: '导入后显示教学、回答和进度', en: 'Teaching, answers, and progress appear after import' },
  'header.workspaceStg': { zh: 'StepsToGreat 工作区', en: 'StepsToGreat workspace' },
  'header.workspacePlain': { zh: '学习文档工作区', en: 'Learning document workspace' },
  'header.noLesson': { zh: '尚未发布当前课程', en: 'No current lesson published yet' },
  'header.recent': { zh: '最近打开：{path}', en: 'Recently opened: {path}' },

  'breadcrumb.workspace': { zh: '工作台', en: 'Workspace' },
  'breadcrumb.welcome': { zh: '欢迎', en: 'Welcome' },

  'welcome.tag': { zh: '本地学习工作台', en: 'Local learning workspace' },
  'welcome.headline': { zh: '一个文件夹，', en: 'One folder,' },
  'welcome.headlineAccent': { zh: '一张清晰的学习桌面。', en: 'one clear learning desk.' },
  'welcome.lead': { zh: '让文档、练习和你的思考待在一起。', en: 'Keep your documents, practice, and thinking together.' },
  'welcome.leadSecond': { zh: '打开学习文件夹，从上次停下的地方继续。', en: 'Open a learning folder and continue where you stopped.' },
  'welcome.dropTitle': { zh: '拖入你的 StepsToGreat 文件夹', en: 'Drop your StepsToGreat folder here' },
  'welcome.dropHint': { zh: '或点击下方按钮，从电脑中选择文件夹', en: 'Or choose a folder from this computer' },
  'welcome.chooseFolder': { zh: '选择学习文件夹', en: 'Choose learning folder' },
  'welcome.noConvert': { zh: '原有目录直接读取，无需转换格式', en: 'Read the existing folder directly; nothing to convert' },
  'welcome.demo': { zh: '先试用演示工作区 →', en: 'Try the demo workspace →' },
  'welcome.feature1Title': { zh: '阅读与编辑', en: 'Read and edit' },
  'welcome.feature1Text': { zh: '清晰排版、公式、表格，直接在文档中编辑。', en: 'Clear typography, formulas, and tables, edited in place.' },
  'welcome.feature2Title': { zh: '专注当前轮', en: 'Focus on this round' },
  'welcome.feature2Text': { zh: '关联学生回答，每次只处理当前轮的问题。', en: 'Linked student answers, one current round at a time.' },
  'welcome.feature3Title': { zh: '留住每次作答', en: 'Keep every answer' },
  'welcome.feature3Text': { zh: '答案追加到原文档，保存前自动备份。', en: 'Answers append to the original document, backed up before saving.' },
  'welcome.webPreview': { zh: '网页界面预览；本地文件功能请使用桌面应用。', en: 'Browser preview; use the desktop app for local files.' },

  'kind.guide': { zh: '教学', en: 'Teaching' },
  'kind.answer': { zh: '回答', en: 'Answers' },
  'kind.route': { zh: '路线', en: 'Route' },
  'kind.profile': { zh: '档案', en: 'Profile' },
  'kind.rules': { zh: '规则', en: 'Rules' },
  'kind.material': { zh: '资料', en: 'Material' },
  'kind.document': { zh: '文档', en: 'Document' },
  // Document tabs use the full paired-document names (also used by lib/documents.cjs).
  'tree.guide': { zh: '教学引导', en: 'Teaching guide' },
  'tree.answer': { zh: '学生回答', en: 'Student answers' },
  // Fixed document-role labels assigned by lib/documents.cjs. A guide's own link
  // text is document content and is deliberately not mapped through these.
  'role.teachingGuide': { zh: '教学引导', en: 'Teaching guide' },
  'role.studentAnswers': { zh: '学生回答', en: 'Student answers' },
  'role.profile': { zh: '学习档案', en: 'Learning profile' },
  'role.rules': { zh: '学习规则', en: 'Learning rules' },
  'role.route': { zh: '课程路线', en: 'Course route' },
  'role.teachingRules': { zh: '教学规则', en: 'Teaching rules' },
  'role.usage': { zh: '使用说明', en: 'Usage notes' },
  'doc.typeGuide': { zh: 'TEACHING GUIDE', en: 'TEACHING GUIDE' },
  'doc.typeAnswer': { zh: 'YOUR ANSWERS', en: 'YOUR ANSWERS' },
  'doc.typeMarkdown': { zh: 'MARKDOWN', en: 'MARKDOWN' },
  'doc.kindBadge': { zh: '{label} · {type}', en: '{label} · {type}' },
  'doc.roundTitle': { zh: '第 {n} 轮 · 教学引导', en: 'Round {n} · Teaching guide' },
  'doc.indexTitle': { zh: '教学总入口', en: 'Lesson index' },
  'doc.focus': { zh: '专注', en: 'Focus' },
  'doc.exitFocus': { zh: '退出专注', en: 'Exit focus' },
  'doc.saved': { zh: '已保存', en: 'Saved' },
  'doc.unsaved': { zh: '待保存到文档', en: 'Unsaved changes' },
  'doc.save': { zh: '保存', en: 'Save' },
  'doc.changeBanner': { zh: '文件夹中的文档有更新。', en: 'A document in this folder changed.' },
  'doc.reload': { zh: '重新加载当前文档', en: 'Reload this document' },
  'doc.popout': { zh: '开窗口 ↗', en: 'Open window ↗' },
  'doc.popoutTitle': { zh: '移到独立窗口，主应用切换到另一份文档', en: 'Open in its own window; the main app switches to the other document' },
  'doc.formula': { zh: '公式', en: 'Formula' },
  'doc.formulaTitle': { zh: '插入数学公式', en: 'Insert a math formula' },
  'doc.answerPanelAria': { zh: '学生作答工作区', en: 'Student answer workspace' },
  'doc.answerHeading': { zh: '作答工作区', en: 'Answer workspace' },
  'doc.answerFocus': { zh: '专注作答', en: 'Focus answers' },
  'doc.answerBack': { zh: '返回对照', en: 'Back to lesson' },
  'doc.answerFocusTitle': { zh: '放大作答区域，按 Esc 返回', en: 'Enlarge the answer area; press Esc to return' },
  'doc.answerDescMissing': { zh: '选择教学引导或学生回答文档。', en: 'Choose a teaching guide or student answer document.' },
  'doc.answerCount': { zh: '{round} · {n} 道题', en: '{round} · {n} questions' },
  'doc.answerCountOne': { zh: '{round} · {n} 道题', en: '{round} · {n} question' },
  'doc.currentRound': { zh: '本轮作答', en: 'This round' },
  'doc.answerRecordsTab': { zh: '作答记录', en: 'Answer history' },
  'doc.fullDocument': { zh: '完整文档', en: 'Full document' },
  'doc.answerTabsAria': { zh: '作答工作区内容', en: 'Answer workspace sections' },
  'doc.roundQuestions': { zh: '切换本轮题目', en: 'Switch questions in this round' },
  'doc.answerRecordsAria': { zh: '历史作答与导师反馈', en: 'Previous answers and tutor feedback' },
  'doc.editorAria': { zh: '学习文档，所见即所得编辑', en: 'Learning document, WYSIWYG editor' },
  'doc.readingAria': { zh: '切换教学与作答', en: 'Switch teaching and answers' },
  'doc.readingPane': { zh: '教学', en: 'Lesson' },
  'doc.answerPane': { zh: '本轮作答', en: 'Answers' },
  'doc.answerPanelResize': { zh: '调整教学与作答宽度', en: 'Resize teaching and answers' },
  'doc.dshPanelResize': { zh: '调整工作台与 DSH 宽度', en: 'Resize workspace and DSH' },
  'doc.separatorTitle': { zh: '拖动调整宽度；双击恢复默认；方向键微调', en: 'Drag to resize; double-click to reset; arrow keys to fine-tune' },
  'doc.separatorValue': { zh: '{leftLabel} {left}%，{rightLabel} {right}%', en: '{leftLabel} {left}%, {rightLabel} {right}%' },
  'doc.detachedBadge': { zh: '窗口中', en: 'In window' },
  'doc.detachedTitle': { zh: '已在独立窗口打开，关闭窗口后返回', en: 'Open in its own window; close it to return' },
  'doc.detachedOpened': { zh: '这份文档已在独立窗口中，关闭窗口后会返回这里。', en: 'This document is open in its own window; close that window to return here.' },
  'doc.progressChapter': { zh: '当前章节进度', en: 'Current chapter progress' },
  'doc.progressOverall': { zh: '总体进度', en: 'Overall progress' },
  'doc.progressLearning': { zh: '已记录的学习进度', en: 'Recorded learning progress' },
  'doc.progressNoLesson': { zh: '尚未选择课程', en: 'No lesson selected yet' },
  'doc.progressEmpty': { zh: '暂无更多进度记录，导师更新文档后会自动刷新。', en: 'No further progress records yet; they refresh when the tutor updates the document.' },
  'doc.footerInfoAria': { zh: '文档信息与操作', en: 'Document information and actions' },
  'doc.fileInfoAria': { zh: '文件信息', en: 'File information' },
  'doc.charCount': { zh: '{n} 字符 · UTF-8 · Markdown', en: '{n} characters · UTF-8 · Markdown' },

  'answer.emptyTitle': { zh: '在这里专注作答', en: 'Answer in focus here' },
  'answer.emptyText': { zh: '教学引导关联同目录的学生回答。', en: 'A teaching guide is linked to the student answers in the same folder.' },
  'answer.fallback': { zh: '这份文档暂不支持按题作答，可以在这里编辑完整回答文档。', en: 'This document does not support per-question answering; edit the full answer document here.' },
  'answer.editFull': { zh: '编辑完整文档', en: 'Edit full document' },
  'answer.question': { zh: '问题 {n}', en: 'Question {n}' },
  'answer.currentQuestion': { zh: '当前问题', en: 'Current question' },
  'answer.prompt': { zh: '题干与示例', en: 'Prompt and example' },
  'answer.expand': { zh: '展开', en: 'Show' },
  'answer.collapse': { zh: '收起', en: 'Hide' },
  'answer.yourAnswer': { zh: '你的回答', en: 'Your answer' },
  'answer.placeholder': { zh: '写下你的理解，或粘贴代码…', en: 'Write your understanding, or paste code…' },
  'answer.insertCode': { zh: '插入代码块', en: 'Insert code block' },
  'answer.charCount': { zh: '{n} 字', en: '{n} characters' },
  'answer.orphanTitle': { zh: '题目变化前的输入', en: 'Input from before the questions changed' },
  'answer.orphanText': { zh: '已保留，请核对后复制到当前题目。', en: 'Kept for you; check it and copy it into the current question.' },
  'answer.discard': { zh: '移除此输入', en: 'Remove this input' },
  'answer.recordNote': { zh: '历史原答与导师反馈按文档原文显示。', en: 'Previous answers and tutor feedback are shown as written in the document.' },
  'answer.noRecords': { zh: '尚未识别到轮次记录，完整文档中的内容仍全部保留。', en: 'No round records found yet; everything in the full document is still kept.' },
  'answer.viewFull': { zh: '查看完整文档', en: 'View full document' },
  'answer.recordsFooter': { zh: '只展示已有记录，不自动生成评估或掌握结果。', en: 'Only existing records are shown; no evaluation or mastery result is generated.' },
  'answer.savedVersion': { zh: '已保存版本', en: 'Saved version' },
  'answer.history': { zh: '历史版本', en: 'History' },
  'answer.sourceAria': { zh: '完整回答文档 Markdown', en: 'Full answer document Markdown' },
  'answer.dirtyShort': { zh: '有修改 · 待保存', en: 'Edited · not saved yet' },
  'answer.saveSource': { zh: '保存回答文档', en: 'Save answer document' },
  'answer.saveSourceNote': { zh: '写入前校验版本并备份，原有轮次和评估完整保留。', en: 'The version is checked and backed up before writing; existing rounds and evaluations stay intact.' },
  'answer.docFooter': { zh: '完整回答文档已在这里展示，可直接编辑或查看历史版本。', en: 'The full answer document is shown here; edit it or view earlier versions.' },
  'answer.footerStatus': { zh: '点击保存，写入回答文档', en: 'Click Save to write the answer document' },
  'answer.submit': { zh: '保存本轮作答', en: 'Save this round' },
  'answer.submitTitle': { zh: '保存所有已填写的本轮答案。回答与学生文档同步，保存后可继续修改。专注作答时可按 Ctrl S 保存。', en: 'Save every answer filled in for this round. Answers sync with the student document and stay editable. Press Ctrl S while focused on answers to save.' },
  'answer.footerNote': { zh: '回答与学生文档同步，保存后可继续修改。', en: 'Answers sync with the student document; you can keep editing after saving.' },
  'answer.navPosition': { zh: '{i} / {n}', en: '{i} / {n}' },
  'answer.navLabel': { zh: '问题 {n}，{state}', en: 'Question {n}, {state}' },
  'answer.filled': { zh: '已填写', en: 'answered' },
  'answer.notFilled': { zh: '未填写', en: 'not answered' },
  'answer.statusDirty': { zh: '有修改 · 点击保存即可写入回答文档', en: 'Edited · click Save to write the answer document' },
  'answer.statusSaved': { zh: '学生文档已保存 · 可继续作答', en: 'Student document saved · you can keep answering' },
  'answer.noDocument': { zh: '尚无配套学生文档', en: 'No student document yet' },
  'answer.roundHistory': { zh: '第{round}轮 · 历史作答', en: 'Round {round} · answer history' },

  'toast.savedChanges': { zh: '现有修改已保存。', en: 'Changes saved.' },
  'toast.saved': { zh: '已保存。', en: 'Saved.' },
  'toast.draftFailed': { zh: '输入保留失败，请点击保存', en: 'Could not keep your input; click Save' },
  'toast.importDesktop': { zh: '请使用桌面应用导入本地文件夹。', en: 'Use the desktop app to import a local folder.' },
  'toast.docsMissing': { zh: '文件夹已导入，但未找到文档。', en: 'Folder imported, but no documents were found.' },
  'toast.documentGone': { zh: '文档可能已移动或删除，请刷新当前文档。', en: 'The document may have moved or been deleted. Refresh the current document.' },
  'toast.warningPrefix': { zh: '文件监测提示：{message}', en: 'File watch notice: {message}' },
  'toast.answerRestored': { zh: '回答文档历史版本已恢复。', en: 'Answer document version restored.' },
  'toast.prefsSaved': { zh: '阅读与备份设置已保存。', en: 'Reading and backup settings saved.' },

  'status.local': { zh: '所有文档保存在你的电脑上', en: 'All documents are saved on your computer' },
  'drop.release': { zh: '松开以导入文件夹', en: 'Release to import the folder' },

  'modal.closeAria': { zh: '关闭', en: 'Close' },
  'modal.eyebrow': { zh: '文档工作台', en: 'Document workspace' },

  'formula.editTitle': { zh: '编辑公式', en: 'Edit formula' },
  'formula.insertTitle': { zh: '插入公式', en: 'Insert formula' },
  'formula.label': { zh: 'LaTeX 公式', en: 'LaTeX formula' },
  'formula.display': { zh: '显示方式', en: 'Display' },
  'formula.inline': { zh: '行内公式', en: 'Inline formula' },
  'formula.block': { zh: '独立公式块', en: 'Display block' },
  'formula.help': { zh: '例如：x^2 + y^2 = z^2、\\frac{a}{b}、\\sum_{i=1}^{n} i。已有公式可双击修改。', en: 'For example: x^2 + y^2 = z^2, \\frac{a}{b}, \\sum_{i=1}^{n} i. Double-click an existing formula to edit it.' },
  'formula.previewAria': { zh: '公式预览', en: 'Formula preview' },
  'formula.required': { zh: '请输入公式。', en: 'Enter a formula.' },
  'formula.multiline': { zh: '多行公式请选择独立公式块。', en: 'Choose a display block for a multi-line formula.' },
  'formula.eyebrow': { zh: '数学公式 · 实时预览', en: 'Math formula · live preview' },
  'formula.previewEmpty': { zh: '在上方输入公式', en: 'Enter a formula above' },
  'formula.empty': { zh: '公式内容为空', en: 'Formula is empty' },
  'formula.tooLong': { zh: '公式过长，已跳过渲染', en: 'Formula is too long and was not rendered' },
  'formula.unavailable': { zh: '公式渲染器不可用', en: 'Formula renderer is unavailable' },
  'formula.invalid': { zh: '公式语法有误', en: 'Invalid formula syntax' },
  'formula.editInlineTitle': { zh: '双击编辑公式', en: 'Double-click to edit formula' },
  'formula.editBlockTitle': { zh: '双击编辑公式块', en: 'Double-click to edit display formula' },

  'pref.title': { zh: '阅读与备份设置', en: 'Reading and backup settings' },
  'pref.eyebrow': { zh: '按你的阅读习惯', en: 'To your reading habits' },
  'pref.fontSize': { zh: '正文字号', en: 'Body text size' },
  'pref.lineHeight': { zh: '行距', en: 'Line height' },
  'pref.readingWidth': { zh: '阅读宽度', en: 'Reading width' },
  'pref.retention': { zh: '每份文档保留的备份数量', en: 'Backups kept per document' },
  'pref.save': { zh: '保存设置', en: 'Save settings' },
  'pref.open': { zh: '阅读设置', en: 'Reading settings' },

  'history.title': { zh: '回答文档历史版本', en: 'Answer document history' },
  'history.note': { zh: '恢复前会备份当前版本；未提交的本轮答案继续保留。', en: 'The current version is backed up before restoring; unsaved answers for this round are kept.' },
  'history.empty': { zh: '尚无历史版本。', en: 'No earlier versions yet.' },
  'history.pick': { zh: '选择版本查看原文。', en: 'Choose a version to preview it.' },
  'history.restore': { zh: '恢复这个版本', en: 'Restore this version' },
  'history.eyebrow': { zh: '学生文档 · 本地备份', en: 'Student document · local backups' },

  'course.title': { zh: '课程与文档', en: 'Lessons and documents' },
  'course.note': { zh: '选择课程后，顶部显示该课的教学、回答和学习进度。', en: 'After choosing a lesson, its teaching, answers, and progress appear at the top.' },
  'course.empty': { zh: '当前没有已发布课程，请在 DSH 中开始学习。', en: 'No published lessons yet. Start learning in DSH.' },
  'course.related': { zh: '相关文档', en: 'Related documents' },
  'course.eyebrow': { zh: '当前课程', en: 'Current lesson' },

  'round.switchTitle': { zh: '切换本章教学轮次', en: 'Switch teaching round' },
  'round.switchAria': { zh: '切换本章教学轮次，当前：{title}', en: 'Switch teaching round, current: {title}' },
  'round.menuAria': { zh: '本章教学轮次', en: 'Teaching rounds for this chapter' },
  'round.index': { zh: '教学总入口', en: 'Lesson index' },
  'round.item': { zh: '第 {n} 轮', en: 'Round {n}' },
  'round.group': { zh: '已留存轮次', en: 'Saved rounds' },
  'round.inWindow': { zh: '窗口中', en: 'In window' },

  'progress.unrecorded': { zh: '尚未记录', en: 'Not recorded yet' },
  // lib/learning-progress.cjs keeps returning the document-derived Chinese
  // display string; the reader localizes the recognized shape only.
  'progress.masteredZh': { zh: '{scope} · {complete} / {total} {unit}已掌握', en: '{scope} · {complete} / {total} {unit} mastered' },
  'progress.pendingZh': { zh: '（{n} {unit}待记录）', en: '(untracked: {n} {unit})' },
  'progress.noteChapter': { zh: '学习档案中的当前轮次与状态。', en: 'The current round and status from the learning profile.' },
  'progress.noteOverall': { zh: '导师更新学习档案后，这里会同步最新进度。', en: 'Progress updates here when the tutor updates the learning profile.' },
  'progress.chapter': { zh: '当前章节', en: 'Current chapter' },
  'progress.recorded': { zh: '已记录的学习进度', en: 'Recorded learning progress' },
  'progress.pendingShort': { zh: '{n} {unit}待记录', en: '{n} {unit} unrecorded' },
  'progress.routeScope': { zh: '课程路线', en: 'Course route' },
  'progress.profileScope': { zh: '学习档案', en: 'Learning profile' },
  'progress.lessonUnit': { zh: '课', en: 'lessons' },
  'progress.itemUnit': { zh: '项', en: 'items' },

  'dsh.title': { zh: 'DSH 导师', en: 'DSH Tutor' },
  'dsh.status.notConnected': { zh: '尚未连接', en: 'Not connected' },
  'dsh.detach': { zh: '独立小窗', en: 'Floating window' },
  'dsh.dock': { zh: '停靠回主窗口', en: 'Dock back into main window' },
  'dsh.pin': { zh: '置顶', en: 'Always on top' },
  'dsh.more': { zh: '更多', en: 'More' },
  'dsh.close': { zh: '收起 DSH', en: 'Collapse DSH' },
  'dsh.minimize': { zh: '最小化', en: 'Minimize' },
  'dsh.reconnect': { zh: '重新连接', en: 'Reconnect' },
  'dsh.newSession': { zh: '新会话', en: 'New session' },
  'dsh.openDesktop': { zh: '打开 DSH 桌面应用', en: 'Open DSH desktop app' },
  'dsh.sessionAria': { zh: '选择同步的 DSH 会话', en: 'Choose the DSH session to sync' },
  'dsh.currentSession': { zh: '当前 DSH 会话', en: 'Current DSH session' },
  'dsh.sessionTitle': { zh: '选择当前学习文件夹的 DSH 会话', en: 'Choose a DSH session for the current learning folder' },
  'dsh.sessionPlaceholder': { zh: '连接后选择同步会话', en: 'Choose a session after connecting' },
  'dsh.workspace': { zh: '工作区：{path}', en: 'Workspace: {path}' },
  'dsh.noWorkspace': { zh: '请先导入学习文件夹', en: 'Import a learning folder first' },
  'dsh.launch.docked': { zh: '打开 DSH 面板 ↗', en: 'Open DSH panel ↗' },
  'dsh.launch.connected': { zh: 'DSH 已连接', en: 'DSH connected' },
  'dsh.launch.connect': { zh: '连接 DSH', en: 'Connect DSH' },
  'dsh.launch.floating': { zh: '显示 DSH 小窗 ↗', en: 'Show DSH window ↗' },
  'dsh.placeholderDocked': { zh: '提问，或告诉导师你的学习目标…', en: 'Ask a question, or tell your tutor your learning goal…' },
  'dsh.placeholderFloating': { zh: '发消息，或继续当前对话…', en: 'Send a message, or continue this conversation…' },
  'dsh.modelPlaceholder': { zh: '连接后选择模型', en: 'Choose a model after connecting' },
  'dsh.modelAria': { zh: '切换模型', en: 'Switch model' },
  'dsh.send': { zh: '发送', en: 'Send' },
  'dsh.stop': { zh: '停止回复', en: 'Stop reply' },
  'dsh.sendTitle': { zh: '发送消息', en: 'Send message' },
  'dsh.inputAria': { zh: '发送给 DSH 的消息', en: 'Message to DSH' },
  'dsh.contextPrefix': { zh: '引用：{label}', en: 'Context: {label}' },
  'dsh.connectBar': { zh: '打开 DSH，与桌面端共用会话', en: 'Open DSH to share the session with the desktop app' },
  'dsh.connectNow': { zh: '连接', en: 'Connect' },
  'dsh.newConfirm': { zh: '在 DSH 中开始新会话？当前对话仍保留在 DSH 历史中。', en: 'Start a new session in DSH? This conversation stays in your DSH history.' },
  'dsh.webOnly': { zh: '请使用桌面应用连接 DSH', en: 'Use the desktop app to connect DSH' },
  'dsh.jump': { zh: '回到最新 ↓', en: 'Back to latest ↓' },
  'dsh.jumpAria': { zh: '回到最新消息并继续跟随回复', en: 'Jump to the latest message and follow replies' },
  'dsh.roleYou': { zh: '你', en: 'You' },
  'dsh.roleError': { zh: '连接提示', en: 'Connection notice' },
  'dsh.roleAssistant': { zh: 'DSH', en: 'DSH' },
  'dsh.copy': { zh: '复制', en: 'Copy' },
  'dsh.copyAria': { zh: '复制消息', en: 'Copy message' },
  'dsh.copied': { zh: '已复制 ✓', en: 'Copied ✓' },
  'dsh.copyFailed': { zh: '复制失败', en: 'Copy failed' },
  'dsh.copyCode': { zh: '复制代码', en: 'Copy code' },
  'dsh.copyCodeAria': { zh: '复制这段代码', en: 'Copy this code' },
  'dsh.codeFallback': { zh: '代码', en: 'Code' },
  'dsh.emptyTitle': { zh: '在这里继续学习', en: 'Continue learning here' },
  'dsh.emptyAsk': { zh: '可以询问当前课程，或告诉导师你的学习目标。', en: 'Ask about the current lesson, or tell your tutor your learning goal.' },
  'dsh.emptyImport': { zh: '先导入学习文件夹，DSH 会关联当前所需文档。', en: 'Import a learning folder and DSH will attach the documents it needs.' },

  'picker.title': { zh: '选择模型', en: 'Choose a model' },
  'picker.count': { zh: '{n} 个可用', en: '{n} available' },
  'picker.countFiltered': { zh: '{shown} / {total}', en: '{shown} / {total}' },
  'picker.search': { zh: '搜索模型或服务商', en: 'Search models or providers' },
  'picker.listAria': { zh: '可用模型', en: 'Available models' },
  'picker.empty': { zh: '没有匹配的模型', en: 'No matching models' },
  'picker.emptyHint': { zh: '试试模型名称或服务商', en: 'Try a model or provider name' },
  'picker.footerSelect': { zh: '↑ ↓ 选择', en: '↑ ↓ select' },
  'picker.footerConfirm': { zh: '确认', en: 'confirm' },
  'picker.footerClose': { zh: '关闭', en: 'close' },
  'picker.switching': { zh: '正在切换模型…', en: 'Switching model…' },
  'picker.switchFailed': { zh: '切换失败，请重试', en: 'Switch failed; try again' },
  'picker.triggerFallback': { zh: '连接后选择模型', en: 'Choose a model after connecting' },
  'picker.triggerAria': { zh: '切换模型，当前：{model}', en: 'Switch model, current: {model}' },

  'editor.copyCode': { zh: '复制代码', en: 'Copy code' },
  'editor.copied': { zh: '已复制', en: 'Copied' },
  'editor.copyFailed': { zh: '复制失败', en: 'Copy failed' },
  'editor.codeLanguage': { zh: '代码语言', en: 'Code language' },
  'editor.codeTools': { zh: '代码块工具', en: 'Code block tools' },
  'editor.answerLanguageAria': { zh: '回答代码语言', en: 'Answer code language' },
  'editor.auto': { zh: '自动识别代码', en: 'Auto-detect code' },
  'editor.autoDetected': { zh: '自动 · {language}', en: 'Auto · {language}' },
  'editor.plainText': { zh: '纯文本', en: 'Plain text' },
  'editor.preserved': { zh: '保留的 Markdown 内容', en: 'Preserved Markdown' },
  'editor.preservedDoc': { zh: '文档标记', en: 'Document marker' },
  'editor.preservedMeta': { zh: '文档元数据', en: 'Document metadata' },
  'editor.preservedMath': { zh: '公式与特殊内容', en: 'Formula and special content' },
  'editor.formulaError': { zh: '公式错误：{error}', en: 'Formula error: {error}' },
  'doc.remoteImageAlt': { zh: '[远程图片未加载] {alt}', en: '[remote image not loaded] {alt}' },
  'drop.subtitle': { zh: 'StepsToGreat · Markdown 工作区', en: 'StepsToGreat · Markdown workspace' },

};

const ATTR_KEYS = {
  'data-i18n-title': 'title',
  'data-i18n-placeholder': 'placeholder',
  'data-i18n-aria-label': 'aria-label',
  'data-i18n-alt': 'alt',
};

export function normalizeLocale(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : DEFAULT_LOCALE;
}

export function interpolate(template, params) {
  if (params == null) return template;
  return String(template).replace(/\{(\w+)\}/g, (all, name) => (
    Object.hasOwn(params, name) ? String(params[name]) : all
  ));
}

export function translate(locale, key, params) {
  const entry = MESSAGES[key];
  if (!entry) return key;
  // Message entries use the short `zh`/`en` form; locales use BCP-47 tags.
  const column = normalizeLocale(locale) === 'en' ? 'en' : 'zh';
  return interpolate(entry[column] ?? entry.zh, params);
}

// lib/editor-formula.mjs is DOM-free and returns a stable Chinese diagnostic.
// Map only those exact diagnostics; KaTeX's own parse message stays verbatim,
// because it is generated text rather than application chrome.
const FORMULA_ERROR_KEYS = {
  '公式内容为空': 'formula.empty',
  '公式过长，已跳过渲染': 'formula.tooLong',
  '公式渲染器不可用': 'formula.unavailable',
  '公式语法有误': 'formula.invalid',
};

export function localizeFormulaError(error, translator) {
  const key = FORMULA_ERROR_KEYS[error];
  return key && translator ? translator(key) : error;
}


export function hasKey(key) {
  return Object.hasOwn(MESSAGES, key);
}

export function readStoredLocale(storage, key = STORAGE_KEY) {
  try {
    return normalizeLocale(storage?.getItem?.(key));
  } catch {
    return DEFAULT_LOCALE;
  }
}

export function createI18n(options = {}) {
  const win = options.window ?? (typeof window !== 'undefined' ? window : null);
  const doc = options.document ?? (typeof document !== 'undefined' ? document : null);
  const storage = options.storage ?? (() => { try { return win?.localStorage; } catch { return null; } })();
  const storageKey = options.storageKey ?? STORAGE_KEY;
  const subscribers = new Set();
  let locale = normalizeLocale(options.locale ?? readStoredLocale(storage, storageKey));

  function t(key, params, fallback) {
    if (!hasKey(key)) return fallback ?? key;
    return translate(locale, key, params);
  }

  function apply(root = doc) {
    if (!root?.querySelectorAll) return;
    for (const element of root.querySelectorAll('[data-i18n]')) {
      const key = element.getAttribute('data-i18n');
      if (!hasKey(key)) continue;
      const params = paramsOf(element);
      element.textContent = t(key, params);
    }
    for (const [attribute, target] of Object.entries(ATTR_KEYS)) {
      for (const element of root.querySelectorAll(`[${attribute}]`)) {
        const key = element.getAttribute(attribute);
        if (!hasKey(key)) continue;
        element.setAttribute(target, t(key, paramsOf(element)));
      }
    }
  }

  function paramsOf(element) {
    const raw = element.getAttribute('data-i18n-params');
    if (!raw) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  function paint() {
    if (doc?.documentElement) {
      doc.documentElement.lang = locale;
      doc.documentElement.dataset.language = locale;
    }
    apply();
    for (const subscriber of [...subscribers]) {
      try { subscriber(locale); } catch { /* one surface must not break the rest */ }
    }
  }

  function setLocale(next, { persist = true, announce = true } = {}) {
    const normalized = normalizeLocale(next);
    if (persist) { try { storage?.setItem?.(storageKey, normalized); } catch { /* storage can be unavailable */ } }
    if (normalized === locale) { if (announce) paint(); return locale; }
    locale = normalized;
    if (announce) {
      paint();
      try { win?.dispatchEvent?.(new win.CustomEvent('stg-language-changed', { detail: { locale } })); } catch { /* no DOM */ }
    }
    return locale;
  }

  function subscribe(listener) {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  }

  if (win?.addEventListener) {
    win.addEventListener('storage', event => {
      if (event.key !== storageKey || event.newValue == null) return;
      setLocale(event.newValue, { persist: false });
    });
    win.addEventListener('stg-language-changed', event => {
      if (event.detail?.locale) setLocale(event.detail.locale, { persist: false, announce: false });
    });
  }

  // Apply the restored preference to static markup as soon as this module loads.
  if (doc?.documentElement) { doc.documentElement.lang = locale; doc.documentElement.dataset.language = locale; }

  return {
    get locale() { return locale; },
    get t() { return t; },
    get apply() { return apply; },
    setLocale,
    subscribe,
    storageKey,
  };
}

// A single shared instance for the renderer. In Node tests importing this module
// is side-effect free; createI18n() is also exported for isolated testing.
export const i18n = createI18n();

export function kindLabel(kind) {
  return i18n.t(`kind.${kind}`);
}

// Fixed context-role labels emitted by lib/documents.cjs. These are application
// labels, not document text, so they can be translated; an unrecognized label
// (a guide's own link text, a file name) is returned unchanged.
const ROLE_KEYS = {
  '教学引导': 'role.teachingGuide',
  '学生回答': 'role.studentAnswers',
  '学习档案': 'role.profile',
  '学习规则': 'role.rules',
  '课程路线': 'role.route',
  '教学规则': 'role.teachingRules',
  '使用说明': 'role.usage',
};

export function localizeRoleLabel(label, translator) {
  const key = ROLE_KEYS[label];
  return key && translator ? translator(key) : label;
}
