const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const { date, mealType, dishes, totalPrice } = event

  if (!date || !mealType || !dishes || dishes.length === 0) {
    return { success: false, message: '参数不完整' }
  }

  try {
    const res = await db.collection('orders').add({
      data: {
        date,
        mealType,
        dishes,
        totalPrice: totalPrice || 0,
        createTime: new Date().toISOString()
      }
    })

    return {
      success: true,
      orderId: res._id,
      message: '点单成功'
    }
  } catch (err) {
    return { success: false, message: '点单失败: ' + err.message }
  }
}
