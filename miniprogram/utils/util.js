// 通用工具函数

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  var y = date.getFullYear()
  var m = String(date.getMonth() + 1).padStart(2, '0')
  var d = String(date.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + d
}

/**
 * 格式化时间为 HH:mm
 */
function formatTime(date) {
  var h = String(date.getHours()).padStart(2, '0')
  var m = String(date.getMinutes()).padStart(2, '0')
  return h + ':' + m
}

/**
 * 获取本周一的日期
 */
function getMonday(date) {
  var d = new Date(date)
  var day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return d
}

/**
 * 获取指定周的起止日期
 */
function getWeekRange(weekOffset) {
  var now = new Date()
  var dayOfWeek = now.getDay() || 7
  var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1)
  monday.setDate(monday.getDate() + weekOffset * 7)
  var sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: formatDate(monday),
    end: formatDate(sunday)
  }
}

/**
 * 分类名称映射
 */
var categoryNames = {
  breakfast: '早餐',
  dinner: '晚餐'
}

function getCategoryName(key) {
  return categoryNames[key] || key
}

/**
 * 生成唯一ID
 */
function generateId() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
}

module.exports = {
  formatDate: formatDate,
  formatTime: formatTime,
  getMonday: getMonday,
  getWeekRange: getWeekRange,
  getCategoryName: getCategoryName,
  generateId: generateId
}
