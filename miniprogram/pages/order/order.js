const app = getApp()

Page({
  data: {
    currentTab: 'breakfast',
    tabs: [
      { key: 'breakfast', name: '早餐', emoji: '🌅' },
      { key: 'dinner', name: '晚餐', emoji: '🌙' }
    ],
    today: '',
    selectedDate: '',
    dateLabel: '',
    todayDishes: [],
    hasPending: false,
    todayTotal: '0.00',
    confirming: false,
    // 历史日志
    historyDate: '',
    historyOrders: [],
    historyQueried: false
  },

  onLoad() {
    var today = this.formatDate(new Date())
    this.setData({ today: today, selectedDate: today })
    this.smartDateNavigate()
    this.updateDateLabel()
    this.loadTodayOrders()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 })
    }
    // 刷新今天日期（防止跨天）
    var today = this.formatDate(new Date())
    if (today !== this.data.today) {
      this.setData({ today: today })
    }
    // 智能日期定位：如果今天无订单但有未来预定，自动跳转到最近的预定日期
    this.smartDateNavigate()
    this.loadTodayOrders()
    if (this.data.historyDate) {
      this.loadHistory()
    }
    // 检测 needRefreshOrders 标记，强制同步云端（loadTodayOrders 已包含云端拉取）
    if (app.globalData.needRefreshOrders) {
      app.globalData.needRefreshOrders = false
      this.loadTodayOrders()
    }
  },

  // 智能日期定位
  smartDateNavigate() {
    var today = this.data.today
    var selectedDate = this.data.selectedDate
    var currentTab = this.data.currentTab
    var allOrders = wx.getStorageSync('orders') || []

    // 检查当前选中日期是否有订单
    var hasSelectedOrders = false
    for (var i = 0; i < allOrders.length; i++) {
      if (allOrders[i].date === selectedDate && allOrders[i].mealType === currentTab) {
        hasSelectedOrders = true
        break
      }
    }

    // 如果当前日期有订单，不跳转
    if (hasSelectedOrders) return

    // 当前日期无订单，查找最近的有订单的日期
    var futureDates = []
    for (var i = 0; i < allOrders.length; i++) {
      if (allOrders[i].date >= today && allOrders[i].mealType === currentTab) {
        if (futureDates.indexOf(allOrders[i].date) === -1) {
          futureDates.push(allOrders[i].date)
        }
      }
    }

    if (futureDates.length > 0) {
      futureDates.sort()
      // 自动跳转到最近的有订单的日期
      this.setData({ selectedDate: futureDates[0] })
      this.updateDateLabel()
      console.log('[荔枝荟] 自动跳转到预定日期: ' + futureDates[0])
    }
  },

  switchTab(e) {
    var tab = e.currentTarget.dataset.tab
    if (tab === this.data.currentTab) return
    this.setData({ currentTab: tab })
    this.smartDateNavigate()
    this.updateDateLabel()
    this.loadTodayOrders()
  },

  // 切换日期
  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value })
    this.updateDateLabel()
    this.loadTodayOrders()
  },

  // 回到今天
  backToToday() {
    this.setData({ selectedDate: this.data.today })
    this.updateDateLabel()
    this.loadTodayOrders()
  },

  // 更新日期标签
  updateDateLabel() {
    var selected = this.data.selectedDate
    var today = this.data.today
    var currentTab = this.data.currentTab
    var mealLabel = currentTab === 'breakfast' ? '早餐' : '晚餐'

    if (selected === today) {
      this.setData({ dateLabel: '今日' + mealLabel + '点单' })
    } else if (selected > today) {
      // 未来日期
      var parts = selected.split('-')
      var month = parseInt(parts[1])
      var day = parseInt(parts[2])
      this.setData({ dateLabel: '预定 ' + month + '月' + day + '日' + mealLabel })
    } else {
      // 过去日期
      this.setData({ dateLabel: '历史记录' })
    }
  },

  // 从本地加载订单并异步同步云端（先展示本地缓存秒开，再拉云端合并）
  async loadTodayOrders() {
    var selectedDate = this.data.selectedDate
    var currentTab = this.data.currentTab
    var allOrders = wx.getStorageSync('orders') || []
    var todayDishes = []
    var hasPending = false

    for (var i = 0; i < allOrders.length; i++) {
      var order = allOrders[i]
      if (order.date === selectedDate && order.mealType === currentTab) {
        var confirmed = !!order.confirmed
        if (!confirmed) hasPending = true
        var dishes = order.dishes || []
        for (var j = 0; j < dishes.length; j++) {
          todayDishes.push({
            dishId: dishes[j].dishId,
            name: dishes[j].name,
            price: dishes[j].price || 0,
            confirmed: confirmed,
            _orderIndex: i,
            _dishIndex: j
          })
        }
      }
    }

    var total = todayDishes.reduce(function(sum, d) {
      return sum + (d.price || 0)
    }, 0)

    this.setData({
      todayDishes: todayDishes,
      hasPending: hasPending,
      todayTotal: total.toFixed(2)
    })

    // 异步从云端拉取并合并（不阻塞 UI）
    if (this._syncingOrders || !app.globalData.cloudReady || !app.globalData.db) return
    this._syncingOrders = true
    try {
      var db = app.globalData.db
      var cloudOrders = await app.fetchAllCloudOrders(db)
      if (cloudOrders && cloudOrders.length > 0) {
        var localOrders = wx.getStorageSync('orders') || []
        var merged = app.mergeOrders(localOrders, cloudOrders)
        // 应用待删列表过滤，避免云端未同步的已删菜品被恢复
        var pendingDeletions = wx.getStorageSync('pendingDeletions') || []
        if (pendingDeletions.length > 0) {
          merged = app.applyPendingDeletions(merged, pendingDeletions)
        }
        wx.setStorageSync('orders', merged)
        console.log('[荔枝荟] 云端订单已合并: 本地 ' + localOrders.length + ' + 云端 ' + cloudOrders.length + ' = ' + merged.length + ' 条')
        // 用合并后的数据刷新视图（_syncingOrders=true 阻止递归同步）
        this.loadTodayOrders()
        // 同步刷新历史
        if (this.data.historyDate) {
          this.loadHistory()
        }
      }
    } catch (err) {
      console.warn('[荔枝荟] 云端订单拉取失败:', err.errMsg || err.message)
    }
    this._syncingOrders = false
  },

  // 移除今日菜品
  removeTodayDish(e) {
    var index = e.currentTarget.dataset.index
    var dish = this.data.todayDishes[index]
    if (!dish || dish.confirmed) return

    var allOrders = wx.getStorageSync('orders') || []
    var oi = dish._orderIndex
    var di = dish._dishIndex

    if (oi === undefined || !allOrders[oi]) return

    // 记录订单信息（用于后续云端同步）
    var orderDate = allOrders[oi].date
    var orderMealType = allOrders[oi].mealType
    var orderCreatorOpenId = allOrders[oi].creatorOpenId
    var orderRemoved = allOrders[oi].dishes.length === 1

    allOrders[oi].dishes.splice(di, 1)
    if (allOrders[oi].dishes.length === 0) {
      allOrders.splice(oi, 1)
    } else {
      allOrders[oi].totalPrice = app.toFixed1(allOrders[oi].dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0))
    }
    wx.setStorageSync('orders', allOrders)

    // 同步更新云端
    if (app.globalData.cloudReady && app.globalData.db && orderCreatorOpenId) {
      var db = app.globalData.db
      db.collection('orders').where({
        date: orderDate,
        mealType: orderMealType,
        creatorOpenId: orderCreatorOpenId
      }).get().then(function(res) {
        if (res.data && res.data.length > 0) {
          var cloudId = res.data[0]._id
          if (orderRemoved) {
            return db.collection('orders').doc(cloudId).remove()
          } else {
            var remainingDishes = allOrders[oi] ? allOrders[oi].dishes : []
            var remainingTotal = allOrders[oi] ? allOrders[oi].totalPrice : 0
            return db.collection('orders').doc(cloudId).update({ data: { dishes: remainingDishes, totalPrice: remainingTotal } })
          }
        }
      }).catch(function(err) {
        console.warn('[荔枝荟] 云端同步移除失败:', err.errMsg || err.message)
      })
    }

    // 标记通知其他设备
    app.globalData.needRefreshOrders = true

    this.loadTodayOrders()
  },

  // 确认下单
  confirmOrder() {
    if (this.data.todayDishes.length === 0) return
    
    // 使用本地设备UUID作为用户标识（同步可用，不依赖云函数）
    var deviceId = app.getDeviceId()
    
    this.setData({ confirming: true })

    var selectedDate = this.data.selectedDate
    var currentTab = this.data.currentTab
    var allOrders = wx.getStorageSync('orders') || []
    var changed = false

    for (var i = 0; i < allOrders.length; i++) {
      var order = allOrders[i]
      if (order.date === selectedDate && order.mealType === currentTab && !order.confirmed) {
        order.confirmed = true
        order.confirmedTime = new Date().toLocaleString('zh-CN')
        // 新增：记录点单者信息
        order.creatorOpenId = app.getDeviceId()
        order.creatorName = wx.getStorageSync('userName') || '成员'
        changed = true
        
        // 同步到云端（upsert：查重后决定新增还是更新）
        if (app.globalData.cloudReady && app.globalData.db) {
          var db = app.globalData.db
          var totalPrice = app.toFixed1(order.dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0))
          var cloudData = {
            date: order.date,
            mealType: order.mealType,
            dishes: order.dishes,
            totalPrice: totalPrice,
            confirmed: true,
            confirmedTime: order.confirmedTime,
            creatorOpenId: order.creatorOpenId,
            creatorName: order.creatorName,
            createTime: new Date().toISOString()
          }
          var thatOrder = order
          // 先查询是否已存在同日期+同餐别+同用户的订单
          db.collection('orders').where({
            date: order.date,
            mealType: order.mealType,
            creatorOpenId: order.creatorOpenId
          }).get().then(function(res) {
            if (res.data && res.data.length > 0) {
              // 已存在 → 更新
              return db.collection('orders').doc(res.data[0]._id).update({ data: cloudData })
            } else {
              // 不存在 → 新增
              return db.collection('orders').add({ data: cloudData })
            }
          }).then(function() {
            console.log('[荔枝荟] 点单已同步到云端')
            app.sendOrderNotification(thatOrder)
          }).catch(function(err) {
            console.warn('[荔枝荟] 云端同步失败，仅保存本地:', err.errMsg || err.message)
          })
        }
      }
    }

    if (changed) {
      wx.setStorageSync('orders', allOrders)
    }

    var that = this
    var dateLabel = selectedDate === this.data.today ? '今日' : selectedDate
    wx.showToast({ title: dateLabel + ' 点单成功', icon: 'success' })
    // 标记通知其他设备
    app.globalData.needRefreshOrders = true
    setTimeout(function() {
      that.setData({ confirming: false })
      that.loadTodayOrders()
    }, 500)
  },

  // 取消预定（删除指定日期的未确认订单）
  cancelPreOrder() {
    var selectedDate = this.data.selectedDate
    var currentTab = this.data.currentTab
    var that = this

    wx.showModal({
      title: '确认取消',
      content: '确定要取消 ' + selectedDate + ' 的预定吗？',
      success: function(res) {
        if (!res.confirm) return

        var allOrders = wx.getStorageSync('orders') || []
        var newOrders = []
        var removed = false

        for (var i = 0; i < allOrders.length; i++) {
          var order = allOrders[i]
          if (order.date === selectedDate && order.mealType === currentTab && !order.confirmed) {
            removed = true
            // 同步删除云端记录
            if (app.globalData.cloudReady && app.globalData.db && order.creatorOpenId) {
              app.globalData.db.collection('orders').where({
                date: selectedDate,
                mealType: currentTab,
                creatorOpenId: order.creatorOpenId,
                confirmed: false
              }).remove().then(function() {
                console.log('[荔枝荟] 云端预定已删除')
              }).catch(function(err) {
                console.warn('[荔枝荟] 云端删除失败:', err.errMsg || err.message)
              })
            }
          } else {
            newOrders.push(order)
          }
        }

        if (removed) {
          wx.setStorageSync('orders', newOrders)
          wx.showToast({ title: '已取消预定', icon: 'success' })
        } else {
          wx.showToast({ title: '无可取消的预定', icon: 'none' })
        }
        that.loadTodayOrders()
      }
    })
  },

  // 选择历史日期
  onHistoryDateChange(e) {
    this.setData({ historyDate: e.detail.value, historyQueried: false })
    this.loadHistory()
  },

  clearHistoryDate() {
    this.setData({ historyDate: '', historyOrders: [], historyQueried: false })
  },

  // 加载历史日志（异步拉取云端合并后显示）
  async loadHistory() {
    var date = this.data.historyDate
    if (!date) return

    // 异步拉取云端数据并合并（仅当没有正在进行的同步时，避免重复请求）
    if (!this._syncingOrders && app.globalData.cloudReady && app.globalData.db) {
      try {
        var db = app.globalData.db
        var cloudOrders = await app.fetchAllCloudOrders(db)
        if (cloudOrders && cloudOrders.length > 0) {
          var localOrders = wx.getStorageSync('orders') || []
          var merged = app.mergeOrders(localOrders, cloudOrders)
          // 应用待删列表过滤，避免云端未同步的已删菜品被恢复
          var pendingDeletions = wx.getStorageSync('pendingDeletions') || []
          if (pendingDeletions.length > 0) {
            merged = app.applyPendingDeletions(merged, pendingDeletions)
          }
          wx.setStorageSync('orders', merged)
        }
      } catch (err) {
        console.warn('[荔枝荟] 云端历史数据拉取失败:', err.errMsg || err.message)
      }
    }

    var allOrders = wx.getStorageSync('orders') || []
    var orders = allOrders.filter(function(o) {
      return o.date === date
    })

    var historyOrders = orders.map(function(o) {
      return {
        date: o.date,
        mealType: o.mealType,
        dishes: o.dishes || [],
        total: (o.totalPrice || 0).toFixed(2)
      }
    })

    this.setData({
      historyOrders: historyOrders,
      historyQueried: true
    })
  },

  formatDate(date) {
    var y = date.getFullYear()
    var m = String(date.getMonth() + 1).padStart(2, '0')
    var d = String(date.getDate()).padStart(2, '0')
    return y + '-' + m + '-' + d
  }
})
