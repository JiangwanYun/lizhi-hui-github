const app = getApp()

Page({
  data: {
    weekOffset: 0,
    weekLabel: '',
    weekDays: [],
    weekOrders: [],
    weeklyTotal: 0,
    loading: true,
    editMode: false,
    editSelectedCount: 0,
    pendingDeletions: [],
    newNotificationCount: 0
  },

  onLoad() {
    // 加载待删追踪列表
    var pending = wx.getStorageSync('pendingDeletions') || []
    this.setData({ pendingDeletions: pending })
    this.buildWeek()
    this.loadWeekOrders()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 2 })
    }
    this.loadWeekOrders()
    // 检测 needRefreshOrders 标记，强制从云端同步订单
    if (app.globalData.needRefreshOrders) {
      app.globalData.needRefreshOrders = false
      this.loadWeekOrders()
    }
  },

  // 上一周
  prevWeek() {
    this.setData({ weekOffset: this.data.weekOffset - 1 })
    this.buildWeek()
    this.loadWeekOrders()
  },

  // 下一周
  nextWeek() {
    if (this.data.weekOffset >= 0) return
    this.setData({ weekOffset: this.data.weekOffset + 1 })
    this.buildWeek()
    this.loadWeekOrders()
  },

  // 构建本周7天的日期
  buildWeek() {
    var now = new Date()
    var dayOfWeek = now.getDay() || 7
    var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek + 1)
    monday.setDate(monday.getDate() + this.data.weekOffset * 7)

    var days = []
    var dayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
    var today = this.formatDate(new Date())

    for (var i = 0; i < 7; i++) {
      var d = new Date(monday)
      d.setDate(monday.getDate() + i)
      var dateStr = this.formatDate(d)
      days.push({
        date: dateStr,
        dayName: dayNames[i],
        dayNum: d.getDate(),
        isToday: dateStr === today,
        breakfast: [],
        dinner: [],
        dayTotal: 0
      })
    }

    var sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    var weekLabel = this.formatDate(monday).substring(5) + ' ~ ' + this.formatDate(sunday).substring(5)
    if (this.data.weekOffset === 0) weekLabel = '本周 (' + weekLabel + ')'
    else if (this.data.weekOffset === -1) weekLabel = '上周 (' + weekLabel + ')'

    this.setData({ weekDays: days, weekLabel: weekLabel })
  },

  // 加载本周订单
  async loadWeekOrders() {
    this.setData({ loading: true })
    try {
      var weekDays = this.data.weekDays
      if (!weekDays || weekDays.length === 0) {
        console.warn('[荔枝荟] weekDays 为空，重新构建')
        this.buildWeek()
        weekDays = this.data.weekDays
      }
      if (!weekDays || weekDays.length === 0) {
        console.error('[荔枝荟] weekDays 构建失败')
        this.setData({ loading: false })
        return
      }
      var startDate = weekDays[0].date
      var endDate = weekDays[6].date
    
      var orders = []
    
      var localOrders = wx.getStorageSync('orders') || []
      orders = localOrders.filter(function(o) {
        return o.date >= startDate && o.date <= endDate
      })
    
      if (app.globalData.cloudReady && app.globalData.db) {
        try {
          var db = app.globalData.db
          var res = await db.collection('orders')
            .where({
              date: db.command.gte(startDate).and(db.command.lte(endDate))
            })
            .orderBy('date', 'asc')
            .limit(100)
            .get()
          if (res.data && res.data.length > 0) {
            // 云端优先策略：同 key 订单用云端版本（确保其他设备的删除同步生效）
            // 本地独有的订单仍然保留，云端独有的订单追加
            var cloudKeys = {}
            for (var ci = 0; ci < res.data.length; ci++) {
              var co = res.data[ci]
              var key = co.date + '_' + co.mealType + '_' + (co.creatorOpenId || '')
              cloudKeys[key] = co
            }
            var mergedOrders = []
            for (var li = 0; li < orders.length; li++) {
              var lo = orders[li]
              var key = lo.date + '_' + lo.mealType + '_' + (lo.creatorOpenId || '')
              if (cloudKeys.hasOwnProperty(key)) {
                // 云端有该订单 → 用云端版本（其他设备的删除操作已生效）
                mergedOrders.push(cloudKeys[key])
                delete cloudKeys[key]
              } else {
                // 本地独有的订单（确认时网络中断未同步到云端）
                mergedOrders.push(lo)
              }
            }
            // 追加云端独有的订单（其他用户在别处创建的）
            for (var key in cloudKeys) {
              mergedOrders.push(cloudKeys[key])
            }
            orders = mergedOrders
          }
        } catch (err) {
          console.warn('[荔枝荟] 云数据库同步失败，使用本地数据')
        }
      }

      for (var i = 0; i < weekDays.length; i++) {
        weekDays[i].breakfast = []
        weekDays[i].dinner = []
        weekDays[i].dayTotal = 0
      }

      var weeklyTotal = 0
      var pendingDeletions = this.data.pendingDeletions || []
      for (var j = 0; j < orders.length; j++) {
        var order = orders[j]
        var orderDishes = order.dishes || []
        
        // 检查订单中是否所有菜品都已标记待删
        var allDishesDeleted = orderDishes.length > 0
        for (var di = 0; di < orderDishes.length; di++) {
          var dishInOrder = orderDishes[di]
          var isDishDeleted = false
          for (var pd = 0; pd < pendingDeletions.length; pd++) {
            if (pendingDeletions[pd].date === order.date &&
                pendingDeletions[pd].mealType === order.mealType &&
                pendingDeletions[pd].dishId === dishInOrder.dishId) {
              isDishDeleted = true
              break
            }
          }
          if (!isDishDeleted) {
            allDishesDeleted = false
            break
          }
        }
        if (allDishesDeleted) continue
        for (var k = 0; k < weekDays.length; k++) {
          if (weekDays[k].date === order.date) {
            if (order.mealType === 'breakfast') {
              weekDays[k].breakfast = weekDays[k].breakfast.concat(order.dishes || [])
            } else {
              weekDays[k].dinner = weekDays[k].dinner.concat(order.dishes || [])
            }
            weekDays[k].dayTotal = app.toFixed1(weekDays[k].dayTotal + (order.totalPrice || 0))
            weeklyTotal = app.toFixed1(weeklyTotal + (order.totalPrice || 0))
            break
          }
        }
      }

      // 过滤待删的单个菜品（订单还在但部分菜品被删）
      for (var di = 0; di < weekDays.length; di++) {
        weekDays[di].breakfast = this._filterDeletedDishes(weekDays[di].breakfast, weekDays[di].date, 'breakfast', pendingDeletions)
        weekDays[di].dinner = this._filterDeletedDishes(weekDays[di].dinner, weekDays[di].date, 'dinner', pendingDeletions)
      }

      for (var di = 0; di < weekDays.length; di++) {
        for (var bi = 0; bi < weekDays[di].breakfast.length; bi++) {
          weekDays[di].breakfast[bi]._selected = false
        }
        for (var dni = 0; dni < weekDays[di].dinner.length; dni++) {
          weekDays[di].dinner[dni]._selected = false
        }
      }

      this.setData({
        weekDays: weekDays,
        weeklyTotal: weeklyTotal,
        loading: false
      })

      // 清理过期的 pendingDeletions（当前周所有订单中已不存在的菜品标记）
      pendingDeletions = this.data.pendingDeletions || []
      var allActiveDishKeys = {}
      for (var oi = 0; oi < orders.length; oi++) {
        var od = orders[oi].dishes || []
        for (var di = 0; di < od.length; di++) {
          allActiveDishKeys[orders[oi].date + '_' + orders[oi].mealType + '_' + od[di].dishId] = true
        }
      }
      var newPending = pendingDeletions.filter(function(pd) {
        return allActiveDishKeys[pd.date + '_' + pd.mealType + '_' + pd.dishId]
      })
      if (newPending.length !== pendingDeletions.length) {
        this.setData({ pendingDeletions: newPending })
        wx.setStorageSync('pendingDeletions', newPending)
      }

      // 检测未读通知（任何用户都检测，云数据权限控制可读范围）
      this.checkNewNotifications()

      // 同步清理 localStorage：用云端优先合并结果替换本周旧订单，确保跨设备同步
      var pendingDeletions = this.data.pendingDeletions || []
      if (pendingDeletions.length > 0 || orders.length > 0) {
        var currentOrders = wx.getStorageSync('orders') || []
        // 构建当前周合并结果的 key 集合
        var mergedKeys = {}
        for (var woi = 0; woi < orders.length; woi++) {
          var wo = orders[woi]
          mergedKeys[wo.date + '_' + wo.mealType + '_' + (wo.creatorOpenId || '')] = true
        }
        // 保留非本周的订单
        var remaining = currentOrders.filter(function(o) {
          var key = o.date + '_' + o.mealType + '_' + (o.creatorOpenId || '')
          return !mergedKeys[key]
        })
        // 合并本周云端优先结果 + 非本周旧订单
        var finalOrders = remaining.concat(orders)
        // 应用待删列表过滤（清除残留已删菜品）
        if (pendingDeletions.length > 0) {
          finalOrders = app.applyPendingDeletions(finalOrders, pendingDeletions)
        }
        wx.setStorageSync('orders', finalOrders)
      }
    } catch (err) {
      console.error('[荔枝荟] loadWeekOrders 异常:', err)
      this.setData({ loading: false })
    }
  },

  // 过滤待删菜品
  _filterDeletedDishes: function(dishes, date, mealType, pendingDeletions) {
    return dishes.filter(function(dish) {
      for (var i = 0; i < pendingDeletions.length; i++) {
        var pd = pendingDeletions[i]
        if (pd.date === date && pd.mealType === mealType && pd.dishId === dish.dishId) {
          return false
        }
      }
      return true
    })
  },

  // 检测未读通知
  checkNewNotifications: function() {
    var that = this
    if (!app.globalData.cloudReady || !app.globalData.db) return
    var db = app.globalData.db
    db.collection('notifications')
      .where({ read: false })
      .orderBy('createTime', 'desc')
      .limit(20)
      .get()
      .then(function(res) {
        var count = (res.data || []).length
        if (count > 0) {
          that.setData({ newNotificationCount: count })
          // 显示最新一条通知
          var latest = res.data[0]
          wx.showToast({
            title: latest.creatorName + ' 点了 ' + latest.dishNames,
            icon: 'none',
            duration: 3000
          })
        }
      })
      .catch(function() {})
  },

  // 标记所有通知为已读
  markNotificationsRead: function() {
    this.setData({ newNotificationCount: 0 })
    if (!app.globalData.cloudReady || !app.globalData.db) return
    var db = app.globalData.db
    db.collection('notifications')
      .where({ read: false })
      .limit(50)
      .get()
      .then(function(res) {
        var promises = []
        ;(res.data || []).forEach(function(doc) {
          promises.push(db.collection('notifications').doc(doc._id).update({ data: { read: true } }))
        })
        return Promise.all(promises)
      })
      .then(function() {
        console.log('[荔枝荟] 通知已标记为已读')
      })
      .catch(function() {})
  },

  formatDate(date) {
    var y = date.getFullYear()
    var m = String(date.getMonth() + 1).padStart(2, '0')
    var d = String(date.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + d
  },

  // 同步从本地 Storage 重建 weekDays（不查询云端，UI 立即刷新）
  rebuildWeekFromLocal: function() {
    var weekDays = this.data.weekDays
    if (!weekDays || weekDays.length === 0) {
      this.buildWeek()
      weekDays = this.data.weekDays
    }
    var startDate = weekDays[0].date
    var endDate = weekDays[6].date

    var localOrders = wx.getStorageSync('orders') || []
    var orders = localOrders.filter(function(o) {
      return o.date >= startDate && o.date <= endDate
    })

    // 重置每天的数据
    for (var i = 0; i < weekDays.length; i++) {
      weekDays[i].breakfast = []
      weekDays[i].dinner = []
      weekDays[i].dayTotal = 0
    }

    var weeklyTotal = 0
    var pendingDeletions = this.data.pendingDeletions || []
    for (var j = 0; j < orders.length; j++) {
      var order = orders[j]
      // 检查是否整单被删
      var isDeleted = false
      for (var pd = 0; pd < pendingDeletions.length; pd++) {
        if (pendingDeletions[pd].date === order.date &&
            pendingDeletions[pd].mealType === order.mealType &&
            !pendingDeletions[pd].dishId) {
          isDeleted = true
          break
        }
      }
      if (isDeleted) continue
      for (var k = 0; k < weekDays.length; k++) {
        if (weekDays[k].date === order.date) {
          if (order.mealType === 'breakfast') {
            weekDays[k].breakfast = weekDays[k].breakfast.concat(order.dishes || [])
          } else {
            weekDays[k].dinner = weekDays[k].dinner.concat(order.dishes || [])
          }
          weekDays[k].dayTotal = app.toFixed1(weekDays[k].dayTotal + (order.totalPrice || 0))
          weeklyTotal = app.toFixed1(weeklyTotal + (order.totalPrice || 0))
          break
        }
      }
    }

    // 过滤待删的单个菜品
    for (var di = 0; di < weekDays.length; di++) {
      weekDays[di].breakfast = this._filterDeletedDishes(weekDays[di].breakfast, weekDays[di].date, 'breakfast', pendingDeletions)
      weekDays[di].dinner = this._filterDeletedDishes(weekDays[di].dinner, weekDays[di].date, 'dinner', pendingDeletions)
    }

    for (var di = 0; di < weekDays.length; di++) {
      for (var bi = 0; bi < weekDays[di].breakfast.length; bi++) {
        weekDays[di].breakfast[bi]._selected = false
      }
      for (var dni = 0; dni < weekDays[di].dinner.length; dni++) {
        weekDays[di].dinner[dni]._selected = false
      }
    }

    this.setData({
      weekDays: weekDays,
      weeklyTotal: weeklyTotal,
      loading: false
    })
  },

  // 长按菜品 → 进入编辑模式（抖动 + 显示删除按钮）
  onDishLongPress: function(e) {
    if (this.data.editMode) return
    this.setData({ editMode: true })
    wx.vibrateShort({ type: 'medium' })
  },

  // 编辑模式下点击菜品 → 切换选中状态
  onSelectDish: function(e) {
    if (!this.data.editMode) return
    var dataset = e.currentTarget.dataset
    var date = dataset.date
    var meal = dataset.meal
    var dishId = dataset.dishId

    var weekDays = this.data.weekDays
    var count = 0
    for (var i = 0; i < weekDays.length; i++) {
      if (weekDays[i].date === date) {
        var dishes = meal === 'breakfast' ? weekDays[i].breakfast : weekDays[i].dinner
        for (var j = 0; j < dishes.length; j++) {
          if (dishes[j].dishId === dishId) {
            dishes[j]._selected = !dishes[j]._selected
          }
          if (dishes[j]._selected) count++
        }
      } else {
        for (var bj = 0; bj < weekDays[i].breakfast.length; bj++) {
          if (weekDays[i].breakfast[bj]._selected) count++
        }
        for (var dj = 0; dj < weekDays[i].dinner.length; dj++) {
          if (weekDays[i].dinner[dj]._selected) count++
        }
      }
    }
    this.setData({ weekDays: weekDays, editSelectedCount: count })
  },

  // 点击 × → 立即删除单个菜品
  onDeleteDish: function(e) {
    var dataset = e.currentTarget.dataset
    var date = dataset.date
    var meal = dataset.meal
    var dishId = dataset.dishId
    var dishName = dataset.dishName || ''

    // 1. 立即从 weekDays 中移除该菜品（UI 即时更新，不影响其他菜品）
    var weekDays = this.data.weekDays
    for (var i = 0; i < weekDays.length; i++) {
      if (weekDays[i].date === date) {
        var dishes = meal === 'breakfast' ? weekDays[i].breakfast : weekDays[i].dinner
        for (var j = dishes.length - 1; j >= 0; j--) {
          if (dishes[j].dishId === dishId) {
            dishes.splice(j, 1)
            break
          }
        }
        // 重算当日费用
        var dayTotal = 0
        for (var bi = 0; bi < weekDays[i].breakfast.length; bi++) dayTotal = app.toFixed1(dayTotal + (weekDays[i].breakfast[bi].price || 0))
        for (var di = 0; di < weekDays[i].dinner.length; di++) dayTotal = app.toFixed1(dayTotal + (weekDays[i].dinner[di].price || 0))
        weekDays[i].dayTotal = dayTotal
        break
      }
    }
    // 重算周总费用
    var weeklyTotal = 0
    for (var i = 0; i < weekDays.length; i++) weeklyTotal = app.toFixed1(weeklyTotal + weekDays[i].dayTotal)

    this.setData({ weekDays: weekDays, weeklyTotal: weeklyTotal })
    wx.showToast({ title: '已删除', icon: 'success' })

    // 2. 从本地 Storage 删除该菜品（遍历所有匹配订单，不仅第一单）
    var allOrders = wx.getStorageSync('orders') || []
    var orderChanged = false
    for (var i = 0; i < allOrders.length; i++) {
      if (allOrders[i].date === date && allOrders[i].mealType === meal) {
        var dishes = allOrders[i].dishes || []
        for (var j = 0; j < dishes.length; j++) {
          if (dishes[j].dishId === dishId) {
            dishes.splice(j, 1)
            if (dishes.length === 0) {
              allOrders.splice(i, 1)
              i--
            } else {
              allOrders[i].totalPrice = dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0)
            }
            orderChanged = true
            break
          }
        }
      }
    }
    if (orderChanged) {
      wx.setStorageSync('orders', allOrders)
    }

    // 3. 加入待删追踪 + 异步云端删除
    this._addPendingDeletion(date, meal, dishId)
    this.syncDeleteToCloud(date, meal, dishId)

    // 4. 检查是否还有菜品，没有则自动退出编辑模式
    var hasAny = false
    for (var di = 0; di < weekDays.length && !hasAny; di++) {
      if (weekDays[di].breakfast.length > 0 || weekDays[di].dinner.length > 0) hasAny = true
    }
    if (!hasAny) this.setData({ editMode: false, editSelectedCount: 0 })
  },

  // 退出编辑模式
  exitEditMode: function() {
    var weekDays = this.data.weekDays
    for (var i = 0; i < weekDays.length; i++) {
      for (var j = 0; j < weekDays[i].breakfast.length; j++) {
        weekDays[i].breakfast[j]._selected = false
      }
      for (var j = 0; j < weekDays[i].dinner.length; j++) {
        weekDays[i].dinner[j]._selected = false
      }
    }
    this.setData({ editMode: false, editSelectedCount: 0, weekDays: weekDays })
  },

  // 批量删除选中菜品
  batchDeleteSelected: function() {
    var weekDays = this.data.weekDays
    var selectedList = []
    for (var i = 0; i < weekDays.length; i++) {
      for (var j = 0; j < weekDays[i].breakfast.length; j++) {
        if (weekDays[i].breakfast[j]._selected) {
          selectedList.push({ date: weekDays[i].date, meal: 'breakfast', dishId: weekDays[i].breakfast[j].dishId })
        }
      }
      for (var j = 0; j < weekDays[i].dinner.length; j++) {
        if (weekDays[i].dinner[j]._selected) {
          selectedList.push({ date: weekDays[i].date, meal: 'dinner', dishId: weekDays[i].dinner[j].dishId })
        }
      }
    }
    if (selectedList.length === 0) {
      wx.showToast({ title: '请先选择菜品', icon: 'none' })
      return
    }

    var that = this
    wx.showModal({
      title: '批量删除',
      content: '确定删除 ' + selectedList.length + ' 个菜品吗？',
      confirmText: '删除',
      confirmColor: '#c1292e',
      success: function(res) {
        if (!res.confirm) return

        var allOrders = wx.getStorageSync('orders') || []
        for (var s = 0; s < selectedList.length; s++) {
          var sd = selectedList[s]
          for (var i = 0; i < allOrders.length; i++) {
            if (allOrders[i].date === sd.date && allOrders[i].mealType === sd.meal) {
              var dishes = allOrders[i].dishes || []
              var foundInOrder = false
              for (var j = 0; j < dishes.length; j++) {
                if (dishes[j].dishId === sd.dishId) {
                  dishes.splice(j, 1)
                  foundInOrder = true
                  break
                }
              }
              if (foundInOrder) {
                allOrders[i].totalPrice = dishes.reduce(function(a, d) { return a + (d.price || 0) }, 0)
                if (dishes.length === 0) allOrders[i]._removeFlag = true
              }
            }
          }
          that.syncDeleteToCloud(sd.date, sd.meal, sd.dishId)
          that._addPendingDeletion(sd.date, sd.meal, sd.dishId)
        }
        allOrders = allOrders.filter(function(o) { return !o._removeFlag })
        wx.setStorageSync('orders', allOrders)

        wx.showToast({ title: '已删除 ' + selectedList.length + ' 项', icon: 'success' })
        that.setData({ editMode: false, editSelectedCount: 0 })
        // 直接重新加载（含云端），确保所有用户数据完整
        that.loadWeekOrders()
      }
    })
  },

  // 本地已删除，同步到云端（删除所有用户同日同餐的该菜品）
  syncDeleteToCloud: function(date, meal, dishId) {
    if (!app.globalData.cloudReady || !app.globalData.db) {
      this._removePendingDeletion(date, meal, dishId)
      return
    }
    var that = this
    var db = app.globalData.db
    db.collection('orders')
      .where({ date: date, mealType: meal })
      .limit(50)
      .get()
      .then(function(res) {
        var cloudOrders = res.data || []
        var promises = []
        for (var i = 0; i < cloudOrders.length; i++) {
          var order = cloudOrders[i]
          var dishes = order.dishes || []
          var found = false
          for (var j = 0; j < dishes.length; j++) {
            if (dishes[j].dishId === dishId) {
              dishes.splice(j, 1)
              found = true
              break
            }
          }
          if (found) {
            if (dishes.length === 0) {
              promises.push(db.collection('orders').doc(order._id).remove())
            } else {
              var newTotal = dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0)
              promises.push(db.collection('orders').doc(order._id).update({
                data: { dishes: dishes, totalPrice: newTotal }
              }))
            }
          }
        }
        if (promises.length > 0) {
          Promise.all(promises).then(function() {
            console.log('[荔枝荟] 云端已同步删除')
            that._removePendingDeletion(date, meal, dishId)
          }).catch(function(err) {
            console.warn('[荔枝荟] 云端同步删除失败:', err)
          })
        } else {
          that._removePendingDeletion(date, meal, dishId)
        }
      }).catch(function(err) {
        console.warn('[荔枝荟] 云端查询失败:', err)
      })
  },

  // 加入待删追踪
  _addPendingDeletion: function(date, meal, dishId) {
    var list = this.data.pendingDeletions.slice()
    // 去重
    for (var i = 0; i < list.length; i++) {
      if (list[i].date === date && list[i].mealType === meal && list[i].dishId === dishId) {
        return
      }
    }
    list.push({ date: date, mealType: meal, dishId: dishId })
    this.setData({ pendingDeletions: list })
    wx.setStorageSync('pendingDeletions', list)
  },

  // 从待删追踪移除
  _removePendingDeletion: function(date, meal, dishId) {
    var list = this.data.pendingDeletions.slice()
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].date === date && list[i].mealType === meal && list[i].dishId === dishId) {
        list.splice(i, 1)
      }
    }
    this.setData({ pendingDeletions: list })
    wx.setStorageSync('pendingDeletions', list)
  },

  // 纯云端删除（本地没有该订单）
  deleteFromCloudOnly: function(date, meal, dishId, dishName) {
    var that = this
    if (!app.globalData.cloudReady || !app.globalData.db) {
      wx.showToast({ title: '删除失败，请重试', icon: 'none' })
      return
    }
    var db = app.globalData.db
    db.collection('orders')
      .where({ date: date, mealType: meal })
      .limit(50)
      .get()
      .then(function(res) {
        var cloudOrders = res.data || []
        var found = false
        var promises = []
        for (var i = 0; i < cloudOrders.length; i++) {
          var order = cloudOrders[i]
          var dishes = order.dishes || []
          for (var j = 0; j < dishes.length; j++) {
            if (dishes[j].dishId === dishId) {
              dishes.splice(j, 1)
              found = true
              if (dishes.length === 0) {
                promises.push(db.collection('orders').doc(order._id).remove())
              } else {
                var newTotal = dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0)
                promises.push(db.collection('orders').doc(order._id).update({
                  data: { dishes: dishes, totalPrice: newTotal }
                }))
              }
              break
            }
          }
          if (found) break
        }
        if (found && promises.length > 0) {
          Promise.all(promises).then(function() {
            that._removePendingDeletion(date, meal, dishId)
            wx.showToast({ title: '已删除', icon: 'success' })
            that.loadWeekOrders()
          }).catch(function(err) {
            console.warn('[荔枝荟] 云端删除失败:', err)
            // 云端删除失败，保留 pendingDeletions 防止数据复活
          })
        } else if (found) {
          // 找到了但不需要删除（菜品已为空）
          that._removePendingDeletion(date, meal, dishId)
          wx.showToast({ title: '已删除', icon: 'success' })
        } else {
          // 云端未找到，也从 pendingDeletions 移除
          that._removePendingDeletion(date, meal, dishId)
          wx.showToast({ title: '未找到该菜品', icon: 'none' })
        }
      }).catch(function(err) {
        wx.showToast({ title: '删除失败', icon: 'none' })
      })
  }
})
