const app = getApp()

Page({
  data: {
    dishes: [],
    sections: [],
    loading: true,
    filterTab: 'all',
    searchKeyword: '',
    tabs: [
      { key: 'all', name: '全部' },
      { key: 'breakfast', name: '早餐' },
      { key: 'dinner', name: '晚餐' }
    ]
  },

  onLoad() {
    this.loadDishes()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 })
    }
    // 每次进入管理页重新加载菜品列表（保留旧数据直到新数据就绪）
    this.loadDishes()
  },

  switchFilter(e) {
    this.setData({ filterTab: e.currentTarget.dataset.tab })
    // 切换筛选只需重新过滤本地数据，不需要重新拉云端
    this.loadDishes(true)
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
    this.applyFilter(this.allDishes)
  },

  // 清除搜索
  clearSearch() {
    this.setData({ searchKeyword: '' })
    this.applyFilter(this.allDishes)
  },

  // 加载菜品（先展示本地缓存，后台异步拉云端）
  // useLocal=true 时仅从本地 Storage 重新加载（用于切换筛选等场景，不拉云端）
  async loadDishes(useLocal) {
    var needRefresh = app.globalData.needRefresh

    // 1. 立即展示本地缓存（秒开，不等待云端）
    var localDishes = wx.getStorageSync('dishes') || []
    if (localDishes.length > 0) {
      this.allDishes = localDishes
      this.applyFilter(localDishes)
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
          console.log('[荔枝荟] 从云端刷新管理页 ' + cloudDishes.length + ' 道菜品' + (needRefresh ? '（强制刷新）' : ''))
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
          this.applyFilter(merged)
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

  // 应用筛选条件并设置数据（使用分组排序）
  applyFilter(dishes) {
    var sections = app.buildManageSections(dishes, this.data.filterTab, this.data.searchKeyword)
    this.setData({ sections: sections })
  },

  loadFromLocal() {
    this.allDishes = app.ensureLocalDishes()
    this.applyFilter(this.allDishes)
    this.setData({ loading: false })
    this.resolveImageUrls()
  },

  // 将 cloud:// 图片文件ID转为临时URL（解决非创建者无法查看图片的问题）
  resolveImageUrls() {
    if (!app.globalData.cloudReady) return
    // 防止重入：正在解析时不重复发起请求
    if (this._resolving) return
    // 处理所有菜品（而非仅当前筛选显示的），确保切换筛选后图片也能显示
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
      // 1. 更新 allDishes（确保切换筛选后图片也能显示）
      var allDishes = that.allDishes || []
      allDishes.forEach(function (d) {
        if (d.imageFileId && allUrlMap[d.imageFileId]) {
          d.imageUrl = allUrlMap[d.imageFileId]
        }
      })
      // 2. 重新筛选以更新当前显示
      that.applyFilter(allDishes)
      // 3. 缓存 imageUrl 到 Storage
      app.saveDishes(allDishes)
      that._resolving = false
      console.log('[荔枝荟] 已解析并缓存 ' + Object.keys(allUrlMap).length + ' 个图片URL')
    })
  },

  getDefaultDishes() {
    return app.buildDefaultDishes()
  },

  // 跳转新增
  addDish() {
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit' })
  },

  // 跳转编辑
  editDish(e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/dish-edit/dish-edit?id=' + id })
  },

  // 删除菜品
  deleteDish(e) {
    var that = this
    var id = e.currentTarget.dataset.id
    var name = e.currentTarget.dataset.name

    wx.showModal({
      title: '确认删除',
      content: '确定要删除「' + name + '」吗？',
      success: async function(res) {
        if (res.confirm) {
          try {
            // 云数据库软删除
            if (app.globalData.cloudReady && app.globalData.db) {
              try {
                await app.globalData.db.collection('dishes').doc(id).update({
                  data: { isActive: false }
                })
              } catch (e) {
                console.warn('[荔枝荟] 云数据库删除失败，仅删除本地')
              }
            }
            // 本地同步：标记为删除而非物理删除
            var localDishes = wx.getStorageSync('dishes') || []
            for (var i = 0; i < localDishes.length; i++) {
              if (localDishes[i]._id === id) {
                localDishes[i].isActive = false
                break
              }
            }
            app.saveDishes(localDishes)

            // 标记需要重新同步，让其他页面感知删除操作
            app.globalData.needRefresh = true
            wx.showToast({ title: '已删除', icon: 'success' })
            that.loadDishes()
          } catch (err) {
            console.error('删除失败:', err)
            wx.showToast({ title: '删除失败', icon: 'none' })
          }
        }
      }
    })
  },

  // 初始化默认数据
  async initData() {
    wx.showLoading({ title: '初始化中...' })
    try {
      // 始终初始化本地数据
      var defaults = app.buildDefaultDishes()
      app.saveDishes(defaults)

      // 云数据库也初始化
      if (app.globalData.cloudReady && app.globalData.db) {
        var db = app.globalData.db
        for (var i = 0; i < defaults.length; i++) {
          try {
            await db.collection('dishes').add({ data: defaults[i] })
          } catch (e) {
            console.warn('[荔枝荟] 云数据库初始化单条失败:', defaults[i].name)
          }
        }
      }

      wx.hideLoading()
      wx.showToast({ title: '初始化成功', icon: 'success' })
      this.loadDishes()
    } catch (err) {
      wx.hideLoading()
      console.error('初始化失败:', err)
      wx.showToast({ title: '初始化失败', icon: 'none' })
    }
  }
})
