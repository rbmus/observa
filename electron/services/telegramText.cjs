function cleanTelegramName(value) {
  return String(value || '')
    .replace(/(?:\p{Extended_Pictographic}\uFE0F?|\p{Regional_Indicator}{1,2}|[#*0-9]\uFE0F?\u20E3)(?:\u200D\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Modifier}|\uFE0F)*/gu, ' ')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu, ' ')
    .replace(/[\u200B-\u200F\uFE0E\uFE0F\uFFF0-\uFFFF]/gu, ' ')
    .replace(/\uFFFD/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s*([·|:])\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = { cleanTelegramName }
