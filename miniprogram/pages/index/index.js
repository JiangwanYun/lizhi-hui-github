const app = getApp()

Page({
  data: {
    currentTab: 'breakfast',
    dishes: [],
    loading: true,
    searchKeyword: '',
    tabs: [
      { key: 'breakfast', name: '早餐', emoji: '🌅' },
      { key: 'dinner', name: '晚餐', emoji: '🌙' }
    ],
    showDatePicker: false,
    pickerDate: '',
    pendingDish: null
  },

  onLoad() {
    // 隐私协议：首次进入时弹出原生对话框
    if (!app.globalData.privacyAgreed) {
      this.showPrivacyModal()
    }
    this.loadDishes()
  },

  // 隐私协议：使用微信原生弹窗（系统级，永远在最顶层，不会被遮挡）
  showPrivacyModal() {
    var that = this
    wx.showModal({
      title: '隐私保护提示',
      content: '荔枝荟将使用以下信息为您服务：\n\n1. 云数据库：存储菜品和订单数据\n2. 云存储：存储菜品图片\n3. 设备标识：区分不同用户\n4. 内容安全：通过微信官方API检测发布内容合规性\n\n数据仅存储于您的微信云开发环境中，不会用于任何商业目的。',
      confirmText: '同意',
      cancelText: '拒绝',
      success: function(res) {
        if (res.confirm) {
          app.agreePrivacy()
        } else {
          app.rejectPrivacy()
        }
      }
    })
  },

  onShow() {
    // 设置自定义tabBar选中状态
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 0 })
    }
    // 每次显示页面刷新菜品数据
    this.loadDishes()
  },

  // 切换Tab
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab
    this.setData({ currentTab: tab })
    this.filterDishes()
    // 切换Tab后确保图片URL已解析（处理异步解析未完成的情况）
    this.resolveImageUrls()
  },

  // 加载所有菜品（先展示本地缓存，后台异步拉云端）
  // useLocal=true 时仅从本地 Storage 重新加载（用于切换筛选等场景，不拉云端）
  async loadDishes(useLocal) {
    var needRefresh = app.globalData.needRefresh

    // 1. 立即展示本地缓存（秒开，不等待云端）
    var localDishes = wx.getStorageSync('dishes') || []
    if (localDishes.length > 0) {
      this.allDishes = localDishes
      this.filterDishes()
      this.resolveImageUrls()
      this.setData({ loading: false })
    } else {
      this.setData({ loading: true })
    }

    // 仅本地模式（切换筛选等场景），不拉云端
    if (useLocal) return

    // 2. 等待初始同步完成（仅在不需要强制刷新时）
    if (!needRefresh && app.globalData.cloudSyncPromise) {
      try { await app.globalData.cloudSyncPromise } catch (e) {}
    }

    // 3. 拉取云端最新数据
    if (app.globalData.cloudReady && app.globalData.db) {
      try {
        var db = app.globalData.db
        var cloudDishes = await app.fetchAllCloudDishes(db)
        if (cloudDishes && cloudDishes.length > 0) {
          console.log('[荔枝荟] 从云端刷新菜单 ' + cloudDishes.length + ' 道菜品' + (needRefresh ? '（强制刷新）' : ''))
          // ========== Layer1：过滤云端异常数据 ==========
          var filteredCloud = app.filterOrphanedCloudDishes(cloudDishes)
          if (filteredCloud && filteredCloud.length > 0) {
            var currentLocal = wx.getStorageSync('dishes') || []
            var merged = app.mergeDishes(currentLocal, filteredCloud)
          // 清除已缓存的图片临时URL，强制重新解析（临时URL约2小时过期）
          merged.forEach(function (d) {
            if (d.imageFileId && d.imageFileId.indexOf('cloud://') === 0) {
              d.imageUrl = ''
            }
          })
          app.saveDishes(merged)
          this.allDishes = merged
          this.filterDishes()
          this.resolveImageUrls()
          this.setData({ loading: false })
          // 清除强制刷新标记
          if (needRefresh) {
            app.globalData.needRefresh = false
          }
        } else {
          // 云端只有过滤掉的脏数据，不做合并
          console.log('[荔枝荟] 云端 ' + cloudDishes.length + ' 道均被过滤')
        }
        }
      } catch (err) {
        console.warn('[荔枝荟] 云端刷新失败，使用本地数据')
      }
    }
  },

  // 从本地缓存加载（备用方案）
  loadFromLocal() {
    this.allDishes = app.ensureLocalDishes()
    this.filterDishes()
    this.setData({ loading: false })
    this.resolveImageUrls()
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
    this.filterDishes()
  },

  // 清除搜索
  clearSearch() {
    this.setData({ searchKeyword: '' })
    this.filterDishes()
  },

  // 按当前Tab + 搜索关键词筛选菜品
  filterDishes() {
    var kw = this.data.searchKeyword
    var dishes = (this.allDishes || []).filter(
      d => d.isActive !== false && d.category === this.data.currentTab
    )
    if (kw && kw.trim()) {
      dishes = app.searchDishes(dishes, kw)
    }
    this.setData({ dishes })
  },

  // 将 cloud:// 图片文件ID转为临时URL（解决非创建者无法查看图片的问题）
  resolveImageUrls() {
    if (!app.globalData.cloudReady) return
    // 防止重入：正在解析时不重复发起请求
    if (this._resolving) return
    // 处理所有菜品（而非仅当前Tab显示的），确保切换Tab后图片也能显示
    var allDishes = this.allDishes || []
    var fileIds = []
    var seen = {}
    allDishes.forEach(function (d) {
      if (d.imageFileId && d.imageFileId.indexOf('cloud://') === 0 && !seen[d.imageFileId]) {
        seen[d.imageFileId] = true
        fileIds.push(d.imageFileId)
      }
    })
    if (fileIds.length === 0) return
    this._resolving = true

    var that = this
    // 分批请求，每批最多50个（微信API限制）
    var BATCH = 50
    var batches = []
    for (var i = 0; i < fileIds.length; i += BATCH) {
      batches.push(fileIds.slice(i, i + BATCH))
    }
    console.log('[荔枝荟] resolveImageUrls: 共 ' + fileIds.length + ' 个图片，分 ' + batches.length + ' 批请求')

    var allUrlMap = {}
    var batchPromises = batches.map(function (batch) {
      return new Promise(function (resolve) {
        wx.cloud.getTempFileURL({
          fileList: batch,
          success: function (res) {
            if (res.fileList) {
              res.fileList.forEach(function (f) {
                if (f.tempFileURL && f.status === 0) allUrlMap[f.fileID] = f.tempFileURL
              })
            }
            resolve()
          },
          fail: function (err) {
            console.warn('[荔枝荟] getTempFileURL批次失败:', err.errMsg || err.message)
            resolve()
          }
        })
      })
    })

    Promise.all(batchPromises).then(function () {
      // 1. 更新 allDishes（确保切换Tab后图片也能显示）
      var allDishes = that.allDishes || []
      allDishes.forEach(function (d) {
        if (d.imageFileId && allUrlMap[d.imageFileId]) {
          d.imageUrl = allUrlMap[d.imageFileId]
        }
      })
      // 2. 重新筛选以更新当前显示
      that.filterDishes()
      // 3. 缓存 imageUrl 到 Storage
      app.saveDishes(allDishes)
      that._resolving = false
      console.log('[荔枝荟] 已解析并缓存 ' + Object.keys(allUrlMap).length + ' 个图片URL')
    })
  },



  // 下拉刷新
  onPullDownRefresh() {
    this.loadDishes().then(() => {
      wx.stopPullDownRefresh()
    })
  },

  // 预览菜品图片
  previewImage(e) {
    const { url } = e.currentTarget.dataset
    if (!url) return
    wx.previewImage({
      current: url,
      urls: [url]
    })
  },

  // 加入购物车：点击购物车图标，弹出日期选择器
  addToOrder(e) {
    var dishId = e.currentTarget.dataset.id
    var dishName = e.currentTarget.dataset.name
    var dishPrice = e.currentTarget.dataset.price || 0
    var category = e.currentTarget.dataset.category || this.data.currentTab

    // 默认今天
    var now = new Date()
    var y = now.getFullYear()
    var m = String(now.getMonth() + 1).padStart(2, '0')
    var d = String(now.getDate()).padStart(2, '0')
    var today = y + '-' + m + '-' + d

    this.setData({
      showDatePicker: true,
      pickerDate: today,
      pendingDish: { dishId: dishId, name: dishName, price: dishPrice, category: category }
    })
  },

  // 日期选择器变化
  onPickerDateChange(e) {
    this.setData({ pickerDate: e.detail.value })
  },

  // 阻止事件冒泡（弹窗内部使用）
  stopPropagation() {},

  // 取消日期选择
  cancelDatePicker() {
    this.setData({ showDatePicker: false, pendingDish: null })
  },

  // 确认加入购物车
  confirmAddToOrder() {
    var pending = this.data.pendingDish
    var orderDate = this.data.pickerDate
    if (!pending || !orderDate) {
      this.cancelDatePicker()
      return
    }

    var dishId = pending.dishId
    var dishName = pending.name
    var dishPrice = pending.price || 0
    var category = pending.category

    // 检查该日期是否已经有未确认的订单
    var localOrders = wx.getStorageSync('orders') || []
    var existingOrder = null
    for (var i = 0; i < localOrders.length; i++) {
      if (localOrders[i].date === orderDate && localOrders[i].mealType === category && !localOrders[i].confirmed) {
        existingOrder = localOrders[i]
        break
      }
    }

    if (existingOrder) {
      // 检查是否已包含此菜品
      var alreadyAdded = false
      for (var j = 0; j < existingOrder.dishes.length; j++) {
        if (existingOrder.dishes[j].dishId === dishId) {
          alreadyAdded = true
          break
        }
      }
      if (alreadyAdded) {
        wx.showToast({ title: dishName + ' 已在点单中', icon: 'none' })
        this.cancelDatePicker()
        return
      }
      // 追加到已有订单
      existingOrder.dishes.push({ dishId: dishId, name: dishName, price: dishPrice })
      existingOrder.totalPrice = app.toFixed1(existingOrder.dishes.reduce(function(sum, d) { return sum + (d.price || 0) }, 0))
      wx.setStorageSync('orders', localOrders)
    } else {
      // 创建新订单
      var newOrder = {
        date: orderDate,
        mealType: category,
        dishes: [{ dishId: dishId, name: dishName, price: dishPrice }],
        totalPrice: dishPrice,
        createTime: new Date().toISOString()
      }
      localOrders.push(newOrder)
      wx.setStorageSync('orders', localOrders)
    }

    // 同步到云端（非阻塞），确保订单有 creatorOpenId
    if (app.globalData.cloudReady && app.globalData.db) {
      var pendingOrder = existingOrder || localOrders[localOrders.length - 1]
      if (!pendingOrder.creatorOpenId) {
        pendingOrder.creatorOpenId = app.getDeviceId()
        wx.setStorageSync('orders', localOrders)
      }
      var db = app.globalData.db
      var cloudData = {
        date: orderDate,
        mealType: category,
        dishes: pendingOrder.dishes,
        totalPrice: pendingOrder.totalPrice,
        creatorOpenId: pendingOrder.creatorOpenId,
        confirmed: false,
        createTime: pendingOrder.createTime || new Date().toISOString()
      }
      db.collection('orders').where({
        date: orderDate,
        mealType: category,
        creatorOpenId: pendingOrder.creatorOpenId
      }).get().then(function(res) {
        if (res.data && res.data.length > 0) {
          return db.collection('orders').doc(res.data[0]._id).update({ data: cloudData })
        } else {
          return db.collection('orders').add({ data: cloudData })
        }
      }).catch(function(err) {
        console.warn('[荔枝荟] 云端同步点单失败:', err.errMsg || err.message)
      })
    }

    // 标记通知其他设备刷新
    app.globalData.needRefreshOrders = true

    // 显示成功提示（含日期信息）
    var now = new Date()
    var y = now.getFullYear()
    var m = String(now.getMonth() + 1).padStart(2, '0')
    var d = String(now.getDate()).padStart(2, '0')
    var today = y + '-' + m + '-' + d
    var dateLabel = (orderDate === today) ? '今日' : orderDate
    wx.showToast({ title: '已加入 ' + dateLabel + ' ' + dishName, icon: 'none' })
    this.cancelDatePicker()
  },

  // 打开隐私政策详情页
  openPrivacyPage() {
    wx.showModal({
      title: '隐私保护指引',
      content: '荔枝荟小程序收集以下信息用于提供服务：\n\n1. 云数据库：存储菜品和订单数据，支持多设备同步\n2. 云存储：存储菜品图片\n3. 设备标识：区分不同用户\n4. 内容安全：通过微信官方API检测发布内容的合规性\n\n我们不会收集您的个人信息，不会将数据用于任何商业目的。数据仅存储于您的微信云开发环境中，您可随时删除。',
      showCancel: false,
      confirmText: '我知道了'
    })
  }
})
