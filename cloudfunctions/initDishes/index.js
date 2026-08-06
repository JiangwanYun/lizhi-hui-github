const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const defaultDishes = {
    breakfast: ['包子', '饺子', '馒头', '水果', '酸奶'],
    dinner: ['回锅肉', '营养炖鸡', '青椒肉丝', '猪肚炖鸡', '鹌鹑蛋红烧肉', '糖醋排骨', '营养炖排骨']
  }

  const now = new Date().toISOString()
  const results = []

  // 检查是否已有数据
  const existing = await db.collection('dishes').count()
  if (existing.total > 0) {
    return { success: false, message: '数据库中已有菜品数据，跳过初始化' }
  }

  // 添加早餐
  for (const name of defaultDishes.breakfast) {
    const res = await db.collection('dishes').add({
      data: {
        name,
        category: 'breakfast',
        price: 0,
        imageFileId: '',
        description: '',
        isActive: true,
        createTime: now
      }
    })
    results.push({ name, id: res._id })
  }

  // 添加晚餐
  for (const name of defaultDishes.dinner) {
    const res = await db.collection('dishes').add({
      data: {
        name,
        category: 'dinner',
        price: 0,
        imageFileId: '',
        description: '',
        isActive: true,
        createTime: now
      }
    })
    results.push({ name, id: res._id })
  }

  return {
    success: true,
    message: `成功初始化 ${results.length} 个菜品`,
    dishes: results
  }
}
