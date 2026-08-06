const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const { startDate, endDate } = event

  if (!startDate || !endDate) {
    return { success: false, message: '请提供 startDate 和 endDate 参数' }
  }

  try {
    const res = await db.collection('orders')
      .where({
        date: _.gte(startDate).and(_.lte(endDate))
      })
      .orderBy('date', 'asc')
      .limit(100)
      .get()

    // 按日期聚合
    const dayMap = {}
    let weeklyTotal = 0

    res.data.forEach(order => {
      if (!dayMap[order.date]) {
        dayMap[order.date] = { breakfast: [], dinner: [], dayTotal: 0 }
      }
      const day = dayMap[order.date]
      if (order.mealType === 'breakfast') {
        day.breakfast = day.breakfast.concat(order.dishes || [])
      } else {
        day.dinner = day.dinner.concat(order.dishes || [])
      }
      day.dayTotal += (order.totalPrice || 0)
      weeklyTotal += (order.totalPrice || 0)
    })

    return {
      success: true,
      orders: res.data,
      dayMap,
      weeklyTotal
    }
  } catch (err) {
    return { success: false, message: '查询失败: ' + err.message }
  }
}
