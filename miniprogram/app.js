App({
  onLaunch: function () {
    this.globalData = {
      db: null,
      fileManager: null,
      cloudReady: false,
      cloudSynced: false,
      cloudSyncPromise: null,
      openIdPromise: null,  // 存储 openid 获取的 promise
      isCreator: false,
      userOpenId: '',
      needRefresh: false,  // 编辑保存后标记，让其他页面强制拉取云端
      needRefreshOrders: false,  // 点单操作后标记，让其他页面强制拉取云端订单
      defaultDishes: {
        breakfast: ['包子', '饺子', '馒头', '水果', '酸奶'],
        dinner: ['回锅肉', '营养炖鸡', '青椒肉丝', '猪肚炖鸡', '鹌鹑蛋红烧肉', '糖醋排骨', '营养炖排骨']
      }
    }

    // 确保本地 Storage 有默认菜品数据
    this.ensureLocalDishes()

    if (!wx.cloud) {
      console.warn('[荔枝荟] 当前基础库不支持云开发，将使用本地存储模式')
      return
    }

    try {
      wx.cloud.init({
        // TODO: 替换为你自己的云开发环境 ID（在微信开发者工具-云开发控制台查看）
        env: 'your-cloud-env-id',
        traceUser: true
      })
      this.globalData.db = wx.cloud.database()
      this.globalData.fileManager = wx.cloud.getTempFileURL
      this.globalData.cloudReady = true
      console.log('[荔枝荟] 云开发初始化成功')
      
      // 获取用户 openid 并判断是否为创建者
      var that = this
      this.globalData.openIdPromise = wx.cloud.callFunction({
        name: 'getOpenId',
      }).then(function(res) {
        if (res.result && res.result.openId) {
          var currentOpenId = res.result.openId
          var creatorOpenId = wx.getStorageSync('creatorOpenId')
          if (!creatorOpenId) {
            // 首个用户，标记为创建者
            wx.setStorageSync('creatorOpenId', currentOpenId)
            that.globalData.isCreator = true
            console.log('[荔枝荟] 当前用户是创建者')
          } else if (creatorOpenId === currentOpenId) {
            // 是创建者
            that.globalData.isCreator = true
            console.log('[荔枝荟] 当前用户是创建者')
          } else {
            // 普通成员
            that.globalData.isCreator = false
            console.log('[荔枝荟] 当前用户是普通成员')
          }
          that.globalData.userOpenId = currentOpenId
        }
      }).catch(function(err) {
        console.warn('[荔枝荟] 获取 openid 失败:', err)
      })
      
      // 异步同步云端数据，并提供 Promise 供页面等待
      this.globalData.cloudSyncPromise = new Promise(function (resolve) {
        that._resolveCloudSync = resolve
      })
      this.syncCloudOnLaunch()
    } catch (e) {
      console.warn('[荔枝荟] 云开发初始化失败，将使用本地存储模式：', e.message)
      this.globalData.cloudReady = false
    }

    // 隐私协议状态（各页面在 onLoad 中检查并主动弹窗）
    this.globalData.privacyAgreed = wx.getStorageSync('privacyAgreed') || false
  },

  // 用户同意隐私协议（由页面按钮触发）
  agreePrivacy: function () {
    this.globalData.privacyAgreed = true
    this.globalData.showPrivacyPopup = false
    wx.setStorageSync('privacyAgreed', true)
    // 关闭当前页面的弹窗
    var pages = getCurrentPages()
    if (pages.length > 0) {
      var currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.setData) {
        currentPage.setData({ showPrivacyPopup: false })
      }
    }
    console.log('[荔枝荟] 用户已同意隐私协议')
  },

  // 用户拒绝隐私协议
  rejectPrivacy: function () {
    this.globalData.showPrivacyPopup = false
    var pages = getCurrentPages()
    if (pages.length > 0) {
      var currentPage = pages[pages.length - 1]
      if (currentPage && currentPage.setData) {
        currentPage.setData({ showPrivacyPopup: false })
      }
    }
  },

  // 保存菜品到 Storage（自动去除 imageBase64 防止超出 10MB 限制）
  saveDishes: function (dishes) {
    var stripped = dishes.map(function (d) {
      return Object.assign({}, d, { imageBase64: '' })
    })
    try {
      wx.setStorageSync('dishes', stripped)
      return true
    } catch (e) {
      console.warn('[荔枝荟] 保存菜品到Storage失败:', e.errMsg || e.message)
      return false
    }
  },

  // 确保本地 Storage 有菜品数据（如果没有则初始化默认菜品）
  ensureLocalDishes: function () {
    var existing = wx.getStorageSync('dishes')
    if (existing && existing.length > 0) {
      return existing
    }
    var dishes = this.buildDefaultDishes()
    this.saveDishes(dishes)
    console.log('[荔枝荟] 已初始化默认菜品到本地存储，共 ' + dishes.length + ' 道')
    return dishes
  },

  // 分页拉取云端所有菜品
  fetchAllCloudDishes: function (db) {
    var PAGE_SIZE = 20  // 微信云数据库客户端单次最多20条
    var allDishes = []

    function fetchPage(skip) {
      return db.collection('dishes')
        .orderBy('createTime', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
        .then(function (res) {
          var data = res.data || []
          allDishes = allDishes.concat(data)
          if (data.length >= PAGE_SIZE) {
            return fetchPage(skip + PAGE_SIZE)
          }
          // 调试：检查云端数据是否包含 name
          var noNameCount = allDishes.filter(function(d) { return !d.name }).length
          if (noNameCount > 0) {
            console.warn('[荔枝荟] 云端有 ' + noNameCount + ' 道菜品缺少name字段')
          }
          return allDishes
        })
    }

    return fetchPage(0)
  },

  // 分页拉取云端所有订单
  fetchAllCloudOrders: function (db) {
    var PAGE_SIZE = 20
    var allOrders = []

    function fetchPage(skip) {
      return db.collection('orders')
        .orderBy('date', 'asc')
        .skip(skip)
        .limit(PAGE_SIZE)
        .get()
        .then(function (res) {
          var data = res.data || []
          allOrders = allOrders.concat(data)
          if (data.length >= PAGE_SIZE) {
            return fetchPage(skip + PAGE_SIZE)
          }
          return allOrders
        })
    }

    return fetchPage(0)
  },

  // 合并订单数组（本地优先，云端补充去重）。以 date+mealType+creatorOpenId 为键
  mergeOrders: function (localOrders, cloudOrders) {
    var localKeys = {}
    for (var li = 0; li < localOrders.length; li++) {
      var lo = localOrders[li]
      var key = lo.date + '_' + lo.mealType + '_' + (lo.creatorOpenId || '')
      localKeys[key] = li
    }
    var merged = localOrders.slice()
    for (var ci = 0; ci < cloudOrders.length; ci++) {
      var co = cloudOrders[ci]
      var key = co.date + '_' + co.mealType + '_' + (co.creatorOpenId || '')
      if (!localKeys.hasOwnProperty(key)) {
        merged.push(co)
      }
    }
    return merged
  },

  // 价格四舍五入到1位小数（最多一位小数）
  toFixed1: function (num) {
    return Math.round((num || 0) * 10) / 10
  },

  // 应用待删列表过滤订单数组，删除菜品级同步到点单页
  applyPendingDeletions: function (orders, pendingDeletions) {
    if (!pendingDeletions || pendingDeletions.length === 0) return orders
    var result = []
    for (var i = 0; i < orders.length; i++) {
      var order = orders[i]
      var dishes = (order.dishes || []).slice()
      var dishChanged = false
      for (var j = dishes.length - 1; j >= 0; j--) {
        var dish = dishes[j]
        for (var pd = 0; pd < pendingDeletions.length; pd++) {
          if (pendingDeletions[pd].date === order.date &&
              pendingDeletions[pd].mealType === order.mealType &&
              pendingDeletions[pd].dishId === dish.dishId) {
            dishes.splice(j, 1)
            dishChanged = true
            break
          }
        }
      }
      if (dishChanged) {
        if (dishes.length > 0) {
          order.dishes = dishes
          order.totalPrice = this.toFixed1(dishes.reduce(function(s, d) { return s + (d.price || 0) }, 0))
          result.push(order)
        }
        // dishes.length === 0 → 整个订单移除，不加入 result
      } else {
        result.push(order)
      }
    }
    return result
  },

  // 合并菜品数组（双向合并，本地和云端取并集）
  mergeDishes: function (localDishes, cloudAllDishes) {
    var cloudMap = {}
    cloudAllDishes.forEach(function (d) { if (d._id) cloudMap[d._id] = d })
    var localMap = {}
    localDishes.forEach(function (d) { if (d._id) localMap[d._id] = d })

    var merged = []
    var seen = {}

    // 1. 处理云端数据
    cloudAllDishes.forEach(function (d) {
      if (d._id && !seen[d._id]) {
        seen[d._id] = true
        var local = localMap[d._id]
        if (local) {
          // 关键修复：如果本地已标记删除，本地删除优先，不再复活云端数据
          if (local.isActive === false) {
            merged.push(Object.assign({}, local))
            return
          }
          // 双向补全图片：云端没有 → 用本地的；本地没有 → 用云端的
          if (!d.imageBase64 && local.imageBase64) {
            d.imageBase64 = local.imageBase64
          }
          if (!d.imageFileId && local.imageFileId) {
            d.imageFileId = local.imageFileId
          }
          // 防御：云端缺少 name 时从本地补回
          if (!d.name && local.name) {
            d.name = local.name
            console.log('[荔枝荟] 从本地补回菜名: ' + local.name)
          }
        }
        // 兜底 name
        if (!d.name) {
          d.name = '未知菜品'
          console.warn('[荔枝荟] 菜品缺少name(_id=' + d._id + ')，已兜底')
        }
        merged.push(d)
      }
    })

    // 2. 本地独有的菜品 → 全部保留（不再丢弃，后续补传到云端）
    localDishes.forEach(function (d) {
      if (d._id && !seen[d._id]) {
        seen[d._id] = true
        merged.push(d)
        console.log('[荔枝荟] 保留本地独有菜品（将补传云端）: ' + d.name)
      }
    })

    return merged
  },

  // 构建默认菜品数据
  buildDefaultDishes: function () {
    var defaults = this.globalData.defaultDishes
    var dishes = []
    var now = new Date().toISOString()
    defaults.breakfast.forEach(function (name, i) {
      dishes.push({
        _id: 'default_b_' + i,
        name: name,
        category: 'breakfast',
        price: 0,
        imageFileId: '',
        description: '',
        isActive: true,
        createTime: now,
        updateTime: now
      })
    })
    defaults.dinner.forEach(function (name, i) {
      dishes.push({
        _id: 'default_d_' + i,
        name: name,
        category: 'dinner',
        price: 0,
        imageFileId: '',
        description: '',
        isActive: true,
        createTime: now,
        updateTime: now
      })
    })
    return dishes
  },

  // ==================== 搜索与分类 ====================

  // 过滤云端异常数据（如无图片的"豌杂面"残留记录）
  // 异步清理云端脏数据，同时从合并列表中移除
  filterOrphanedCloudDishes: function (cloudDishes) {
    var orphans = []
    var filtered = (cloudDishes || []).filter(function (d) {
      // 筛选条件：名称为"豌杂面" + 无图片 + 云端标记为激活
      if (d.name === '豌杂面' && d.isActive !== false && !d.imageFileId && !d.imageBase64) {
        console.warn('[荔枝荟] 过滤云端异常"豌杂面"(_id=' + d._id + ')')
        orphans.push(d._id)
        return false
      }
      return true
    })
    // 异步清理云端记录（不阻塞当前同步流程）
    if (orphans.length > 0 && this.globalData.cloudReady && this.globalData.db) {
      var db = this.globalData.db
      var that = this
      console.warn('[荔枝荟] 开始异步清理 ' + orphans.length + ' 条云端残留"豌杂面"记录')
      orphans.forEach(function (id) {
        db.collection('dishes').doc(id).update({
          data: { isActive: false }
        }).then(function () {
          console.log('[荔枝荟] 云端"豌杂面"(_id=' + id + ')已标记删除')
        }).catch(function (err) {
          console.warn('[荔枝荟] 清理云端"豌杂面"失败:', id, err.errMsg || err.message)
        })
      })
    }
    return filtered
  },

  // 同义词词典（同组内互为同义词，搜索时互相命中）
  DISH_SYNONYMS: [
    ['猪脚', '猪蹄', '猪手'],
    ['土豆', '洋芋', '马铃薯'],
    ['西红柿', '番茄'],
    ['包菜', '卷心菜', '莲花白', '圆白菜'],
    ['粉条', '粉丝', '红薯粉'],
    ['玉米', '苞谷', '包谷'],
    ['豆角', '四季豆', '芸豆'],
    ['蒜薹', '蒜苔'],
    ['鸡蛋', '洋鸡蛋'],
    ['花菜', '菜花', '花椰菜'],
    ['西兰花', '西蓝花', '青花菜'],
    ['红薯', '地瓜', '番薯'],
    ['莴笋', '莴苣', '青笋']
  ],

  // 将关键词扩展为同义词集合
  expandKeyword: function (keyword) {
    var kw = (keyword || '').trim().toLowerCase()
    var terms = kw ? [kw] : []
    if (!kw) return terms
    this.DISH_SYNONYMS.forEach(function (group) {
      var hit = group.some(function (w) {
        var lw = w.toLowerCase()
        return kw.indexOf(lw) !== -1 || lw.indexOf(kw) !== -1
      })
      if (hit) {
        group.forEach(function (w) {
          var lw = w.toLowerCase()
          if (terms.indexOf(lw) === -1) terms.push(lw)
        })
      }
    })
    return terms
  },

  // 按关键词（含同义词）过滤菜品；空关键词返回原数组
  searchDishes: function (dishes, keyword) {
    var kw = (keyword || '').trim()
    if (!kw) return dishes
    var terms = this.expandKeyword(kw)
    return (dishes || []).filter(function (d) {
      var name = (d.name || '').toLowerCase()
      var desc = (d.description || '').toLowerCase()
      return terms.some(function (t) {
        return name.indexOf(t) !== -1 || desc.indexOf(t) !== -1
      })
    })
  },

  // 荤关键词
  _meatKeywords: ['肉', '鸡', '鸭', '鹅', '鱼', '虾', '蟹', '排骨', '猪', '牛', '羊', '肚', '肠', '蹄', '鹌鹑'],
  // 素关键词
  _vegKeywords: ['豆腐', '青菜', '白菜', '菠菜', '生菜', '芹菜', '韭菜', '土豆', '洋芋', '茄子', '豆角', '四季豆', '蘑菇', '香菇', '金针菇', '木耳', '菌', '黄瓜', '番茄', '西红柿', '萝卜', '花菜', '西兰花', '豆芽', '冬瓜', '南瓜', '苦瓜', '莴笋', '蒜薹', '蒜苔', '包菜', '卷心菜', '秋葵', '山药', '藕', '玉米', '海带', '粉条'],
  // 炖菜关键词
  _stewKeywords: ['炖', '煲', '汤', '焖', '卤'],

  // 计算菜品所属分组：{key, title, order}
  // order 用于排序：早餐0 / 晚餐素菜1 / 晚餐荤菜炖菜2 / 晚餐荤菜炒菜3
  getDishGroup: function (dish) {
    if (!dish) return { key: 'dinner_stir', title: '晚餐 · 荤菜 · 炒菜', order: 3 }
    if (dish.category === 'breakfast') {
      return { key: 'breakfast', title: '早餐', order: 0 }
    }
    var name = dish.name || ''
    var contains = function (list) {
      return list.some(function (k) { return name.indexOf(k) !== -1 })
    }
    // 1. 蒸蛋 → 素菜（最高优先级）
    var isVeg
    if (name.indexOf('蒸蛋') !== -1) {
      isVeg = true
    } else if (contains(this._meatKeywords)) {
      isVeg = false
    } else if (contains(this._vegKeywords)) {
      isVeg = true
    } else {
      // 无法识别 → 默认荤菜
      isVeg = false
    }

    if (isVeg) {
      return { key: 'dinner_veg', title: '晚餐 · 素菜', order: 1 }
    }
    // 荤菜内区分 炖/炒
    if (contains(this._stewKeywords)) {
      return { key: 'dinner_stew', title: '晚餐 · 荤菜 · 炖菜', order: 2 }
    }
    return { key: 'dinner_stir', title: '晚餐 · 荤菜 · 炒菜', order: 3 }
  },

  // 构建管理页分组：过滤 isActive → 搜索 → tab筛选 → 分组排序
  // 返回 [{ key, title, dishes }]，剔除空组
  buildManageSections: function (dishes, filterTab, keyword) {
    var that = this
    var list = (dishes || []).filter(function (d) { return d.isActive !== false })
    // 搜索过滤
    list = this.searchDishes(list, keyword)
    // tab 筛选
    if (filterTab && filterTab !== 'all') {
      list = list.filter(function (d) { return d.category === filterTab })
    }
    // 分组
    var groupMap = {}
    var groupOrder = {}
    list.forEach(function (d) {
      var g = that.getDishGroup(d)
      if (!groupMap[g.key]) {
        groupMap[g.key] = { key: g.key, title: g.title, order: g.order, dishes: [] }
        groupOrder[g.key] = g.order
      }
      groupMap[g.key].dishes.push(d)
    })
    var sections = []
    Object.keys(groupMap).forEach(function (k) { sections.push(groupMap[k]) })
    sections.sort(function (a, b) { return a.order - b.order })
    return sections
  },

  globalData: {
    db: null,
    fileManager: null,
    cloudReady: false,
    defaultDishes: {
      breakfast: ['包子', '饺子', '馒头', '水果', '酸奶'],
      dinner: ['回锅肉', '营养炖鸡', '青椒肉丝', '猪肚炖鸡', '鹌鹑蛋红烧肉', '糖醋排骨', '营养炖排骨']
    }
  },

  // 启动时同步：拉取云端 → 合并 → 补传本地独有菜品到云端
  syncCloudOnLaunch: function () {
    if (!this.globalData.cloudReady || !this.globalData.db) {
      if (this._resolveCloudSync) this._resolveCloudSync()
      return
    }
    var db = this.globalData.db
    var that = this

    that.fetchAllCloudDishes(db).then(function (cloudDishes) {
      var localDishes = wx.getStorageSync('dishes') || []

      // ========== Layer1：过滤云端异常数据（无图片的"豌杂面"残留记录） ==========
      var filteredCloud = that.filterOrphanedCloudDishes(cloudDishes)

      if (filteredCloud.length > 0) {
        // 云端有数据 → 双向合并
        var merged = that.mergeDishes(localDishes, filteredCloud)

        // ========== Layer2：同步本地删除状态到云端 ==========
        // 如果本地有 isActive:false 但云端 isActive:true，云端也标记删除
        var cloudMap = {}
        cloudDishes.forEach(function (d) { if (d._id) cloudMap[d._id] = d })
        var localMap = {}
        localDishes.forEach(function (d) { if (d._id) localMap[d._id] = d })
        var deleteSyncPromises = []
        merged.forEach(function (d) {
          var localD = localMap[d._id]
          var cloudD = cloudMap[d._id]
          if (localD && cloudD && localD.isActive === false && cloudD.isActive !== false) {
            console.log('[荔枝荟] 同步删除到云端: ' + d.name + '(_id=' + d._id + ')')
            deleteSyncPromises.push(
              db.collection('dishes').doc(d._id).update({
                data: { isActive: false }
              }).catch(function (err) {
                console.warn('[荔枝荟] 同步删除到云端失败:', d._id, err.errMsg || err.message)
              })
            )
          }
        })
        if (deleteSyncPromises.length > 0) {
          Promise.all(deleteSyncPromises).then(function () {
            console.log('[荔枝荟] 已同步 ' + deleteSyncPromises.length + ' 条本地删除到云端')
          })
        }

        that.saveDishes(merged)
        console.log('[荔枝荟] 云端 ' + cloudDishes.length + ' 道（过滤后 ' + filteredCloud.length + ' 道）+ 本地合并后 ' + merged.length + ' 道')

        // 补传本地独有菜品到云端（本地有但云端没有的）
        var cloudIdSet = {}
        filteredCloud.forEach(function (d) { if (d._id) cloudIdSet[d._id] = true })
        var toUpload = merged.filter(function (d) {
          return d._id && !cloudIdSet[d._id] && d.isActive !== false
        })
        if (toUpload.length > 0) {
          console.log('[荔枝荟] 发现 ' + toUpload.length + ' 道本地独有菜品，补传云端')
          var promises = toUpload.map(function (dish) {
            return db.collection('dishes').doc(dish._id).set({
              data: {
                name: dish.name,
                category: dish.category,
                price: dish.price || 0,
                imageBase64: dish.imageBase64 || '',
                imageFileId: dish.imageFileId || '',
                description: dish.description || '',
                isActive: true,
                createTime: dish.createTime || new Date().toISOString(),
                updateTime: dish.updateTime || dish.createTime || new Date().toISOString()
              }
            }).catch(function (err) {
              console.warn('[荔枝荟] 补传失败: ' + dish.name, err.errMsg || err.message)
            })
          })
          Promise.all(promises).then(function () {
            console.log('[荔枝荟] 补传完成')
            that.globalData.cloudSynced = true
            if (that._resolveCloudSync) that._resolveCloudSync()
          })
        } else {
          that.globalData.cloudSynced = true
          if (that._resolveCloudSync) that._resolveCloudSync()
        }
      } else if (cloudDishes.length === 0) {
        // 云端真正无数据 → 上传全部本地菜品
        console.log('[荔枝荟] 云端无数据，上传本地 ' + localDishes.length + ' 道菜品')
        var promises = []
        localDishes.forEach(function (dish) {
          if (dish.isActive === false) return
          promises.push(db.collection('dishes').doc(dish._id).set({
            data: {
              name: dish.name,
              category: dish.category,
              price: dish.price || 0,
              imageBase64: dish.imageBase64 || '',
              imageFileId: dish.imageFileId || '',
              description: dish.description || '',
              isActive: true,
              createTime: dish.createTime || new Date().toISOString(),
              updateTime: dish.updateTime || dish.createTime || new Date().toISOString()
            }
          }))
        })
        Promise.all(promises).then(function () {
          return that.fetchAllCloudDishes(db)
        }).then(function (r) {
          if (r && r.length > 0) {
            var currentLocal = wx.getStorageSync('dishes') || []
            var merged = that.mergeDishes(currentLocal, r)
            that.saveDishes(merged)
            console.log('[荔枝荟] 上传完成，合并后共 ' + merged.length + ' 道菜品')
          }
          that.globalData.cloudSynced = true
          if (that._resolveCloudSync) that._resolveCloudSync()
        }).catch(function (err) {
          console.warn('[荔枝荟] 上传同步失败:', err.errMsg || err.message)
          that.globalData.cloudSynced = true
          if (that._resolveCloudSync) that._resolveCloudSync()
        })
      } else {
        // 云端只有被过滤的脏数据（如无图片的"豌杂面"），直接完成同步
        console.log('[荔枝荟] 云端 ' + cloudDishes.length + ' 道均被过滤，无需合并')
        that.globalData.cloudSynced = true
        if (that._resolveCloudSync) that._resolveCloudSync()
      }
    }).catch(function (err) {
      console.warn('[荔枝荟] 云同步查询失败:', err.errMsg || err.message)
      that.globalData.cloudSynced = true
      if (that._resolveCloudSync) that._resolveCloudSync()
    })
    // ========== 启动时同步订单 ==========
    that.syncOrdersOnLaunch()
  },

  // 启动时同步订单
  syncOrdersOnLaunch: function () {
    if (!this.globalData.cloudReady || !this.globalData.db) {
      return
    }
    var that = this
    var db = this.globalData.db
    that.fetchAllCloudOrders(db).then(function (cloudOrders) {
      if (!cloudOrders || cloudOrders.length === 0) return
      var localOrders = wx.getStorageSync('orders') || []
      var merged = that.mergeOrders(localOrders, cloudOrders)
      // 应用待删列表过滤，避免云端未同步的已删菜品在启动时被恢复
      var pendingDeletions = wx.getStorageSync('pendingDeletions') || []
      if (pendingDeletions.length > 0) {
        merged = that.applyPendingDeletions(merged, pendingDeletions)
      }
      wx.setStorageSync('orders', merged)
      console.log('[荔枝荟] 启动时同步订单: 云端 ' + cloudOrders.length + ' 条 + 本地 ' + localOrders.length + ' 条 = ' + merged.length + ' 条')
    }).catch(function (err) {
      console.warn('[荔枝荟] 启动时订单同步失败:', err.errMsg || err.message)
    })
  },

  // 获取是否为创建者
  getIsCreator: function() {
    return this.globalData.isCreator
  },

  // 获取用户 openid
  getUserOpenId: function() {
    return this.globalData.userOpenId
  },

  // 获取本地设备唯一标识（同步获取，不依赖云函数）
  getDeviceId: function() {
    var id = wx.getStorageSync('deviceUUID')
    if (!id) {
      id = 'device_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8)
      wx.setStorageSync('deviceUUID', id)
    }
    return id
  },

  // 重置所有点单数据（本地 + 云端）
  resetAllOrders: function() {
    var that = this
    // 1. 清除本地 orders
    wx.removeStorageSync('orders')
    console.log('[荔枝荟] 本地 orders 已清零')

    // 2. 尝试清除云端 orders 集合
    if (this.globalData.cloudReady && this.globalData.db) {
      var db = this.globalData.db
      db.collection('orders').limit(100).get().then(function(res) {
        var count = (res.data || []).length
        if (count === 0) {
          console.log('[荔枝荟] 云端 orders 已为空')
          wx.showToast({ title: '数据已清零（共0条云端记录）', icon: 'success' })
          return
        }
        // 逐条删除
        var promises = []
        res.data.forEach(function(doc) {
          promises.push(db.collection('orders').doc(doc._id).remove())
        })
        return Promise.all(promises).then(function() {
          console.log('[荔枝荟] 云端 orders 已清除 ' + count + ' 条')
          wx.showToast({ title: '数据已清零（清除' + count + '条云端记录）', icon: 'success' })
        })
      }).catch(function(err) {
        console.warn('[荔枝荟] 清除云端 orders 失败:', err)
        wx.showToast({ title: '本地已清零，云端清除失败', icon: 'none' })
      })
    } else {
      wx.showToast({ title: '数据已清零（仅本地）', icon: 'success' })
    }
  },

  // 发送点单通知（云端记录 + 本地提示）
  sendOrderNotification: function(order) {
    var totalPrice = (order.dishes || []).reduce(function(s, d) { return s + (d.price || 0) }, 0)
    var dishNames = (order.dishes || []).map(function(d) { return d.name }).join('、')
    
    console.log('[荔枝荟] 📢 新点单: ' + (order.creatorName || '成员') + ' | ' + dishNames + ' | ¥' + totalPrice.toFixed(2))
    
    // 将通知写入云端共享文档，供开发者在周报页检测
    if (this.globalData.cloudReady && this.globalData.db) {
      var db = this.globalData.db
      var notiData = {
        type: 'order_confirmed',
        creatorName: order.creatorName || '成员',
        dishNames: dishNames,
        totalPrice: totalPrice,
        confirmedTime: order.confirmedTime,
        date: order.date,
        mealType: order.mealType,
        read: false,
        createTime: new Date().toISOString()
      }
      db.collection('notifications').add({ data: notiData }).then(function() {
        console.log('[荔枝荟] 通知已写入云端')
      }).catch(function(err) {
        console.warn('[荔枝荟] 通知写入云端失败:', err.errMsg || err.message)
      })
    }
  }
})
