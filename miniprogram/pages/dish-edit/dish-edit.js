const app = getApp()

Page({
  data: {
    isEdit: false,
    dishId: '',
    name: '',
    category: 'dinner',
    categoryOptions: [
      { key: 'breakfast', name: '早餐' },
      { key: 'dinner', name: '晚餐' }
    ],
    price: '',
    description: '',
    imageFileId: '',
    imageBase64: '',
    imageLocalPath: '',
    saving: false,
    uploading: false
  },

  onLoad(options) {
    // 隐私协议：首次进入时弹出原生对话框
    if (!app.globalData.privacyAgreed) {
      this.showPrivacyModal()
    }
    if (options.id) {
      this.setData({ isEdit: true, dishId: options.id })
      wx.setNavigationBarTitle({ title: '编辑菜品' })
      this.loadDish(options.id)
    } else {
      wx.setNavigationBarTitle({ title: '新增菜品' })
    }
  },

  async loadDish(id) {
    // 优先尝试云数据库
    try {
      if (app.globalData.cloudReady && app.globalData.db) {
        var res = await app.globalData.db.collection('dishes').doc(id).get()
        var dish = res.data
        if (dish) {
          this.setData({
            name: dish.name || '',
            category: dish.category || 'dinner',
            price: dish.price ? String(dish.price) : '',
            description: dish.description || '',
            imageBase64: dish.imageBase64 || '',
            imageFileId: dish.imageFileId || ''
          })
          return
        }
      }
    } catch (err) {
      console.warn('[荔枝荟] 云数据库不可用，已切换本地模式:', err.errMsg || err.message)
    }

    // 本地兜底：ensureLocalDishes 保证 Storage 一定有数据
    var localDishes = app.ensureLocalDishes()
    for (var i = 0; i < localDishes.length; i++) {
      if (localDishes[i]._id === id) {
        var d = localDishes[i]
        this.setData({
          name: d.name || '',
          category: d.category || 'dinner',
          price: d.price ? String(d.price) : '',
          description: d.description || '',
          imageBase64: d.imageBase64 || '',
          imageFileId: d.imageFileId || ''
        })
        return
      }
    }
    // 如果还是找不到，可能是数据不一致，提示用户
    wx.showToast({ title: '菜品未找到', icon: 'none' })
  },

  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },

  onPriceInput(e) {
    this.setData({ price: e.detail.value })
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value })
  },

  onCategoryChange(e) {
    var index = e.currentTarget.dataset.index
    var key = this.data.categoryOptions[index].key
    this.setData({ category: key })
  },

  // 选择图片
  chooseImage() {
    var that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: function(res) {
        if (!res.tempFiles || res.tempFiles.length === 0) {
          wx.showToast({ title: '未选择图片', icon: 'none' })
          return
        }
        // 兼容不同版本的返回字段
        var tempFilePath = res.tempFiles[0].tempFilePath || res.tempFiles[0].file
        if (!tempFilePath) {
          wx.showToast({ title: '图片路径获取失败', icon: 'none' })
          return
        }
        that.setData({ imageLocalPath: tempFilePath, imageFileId: '', imageBase64: '' })
        // 立即压缩并转base64
        that.compressAndEncode(tempFilePath)
      },
      fail: function(err) {
        console.warn('[荔枝荟] 选择图片失败:', err.errMsg || err.message)
        // 区分用户取消和权限/隐私问题
        if (err.errMsg && err.errMsg.indexOf('cancel') !== -1) {
          // 用户主动取消，不提示
          return
        }
        wx.showToast({ title: '无法选择图片，请检查权限设置', icon: 'none', duration: 2000 })
      }
    })
  },

  // 压缩图片并转为 base64（存入数据库，无需云存储）
  compressAndEncode(filePath) {
    var that = this
    that.setData({ uploading: true })
    wx.getImageInfo({
      src: filePath,
      success: function(info) {
        // 计算压缩尺寸（最大宽400px）
        var maxW = 400, w = info.width, h = info.height
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW }
        // 用 canvas 压缩
        var ctx = wx.createCanvasContext('_compressCanvas', that)
        ctx.drawImage(filePath, 0, 0, w, h)
        ctx.draw(false, function() {
          setTimeout(function() {
            wx.canvasToTempFilePath({
              canvasId: '_compressCanvas',
              fileType: 'jpg',
              quality: 0.6,
              destWidth: w,
              destHeight: h,
              success: function(r) {
                // 读取压缩后的文件为 base64
                var fs = wx.getFileSystemManager()
                fs.readFile({
                  filePath: r.tempFilePath,
                  encoding: 'base64',
                  success: function(fRes) {
                    var base64 = 'data:image/jpeg;base64,' + fRes.data
                    that.setData({ imageBase64: base64, uploading: false })
                    console.log('[荔枝荟] 图片压缩完成，大小约 ' + Math.round(base64.length / 1024) + 'KB')
                  },
                  fail: function() {
                    // 压缩失败，直接读原图
                    fs.readFile({
                      filePath: filePath,
                      encoding: 'base64',
                      success: function(f2) {
                        that.setData({ imageBase64: 'data:image/jpeg;base64,' + f2.data, uploading: false })
                      },
                      fail: function() { that.setData({ uploading: false }) }
                    })
                  }
                })
              },
              fail: function() { that.setData({ uploading: false }) }
            }, that)
          }, 200)
        })
      },
      fail: function() {
        // 获取图片信息失败，直接读原文件
        var fs = wx.getFileSystemManager()
        fs.readFile({
          filePath: filePath,
          encoding: 'base64',
          success: function(fRes) {
            that.setData({ imageBase64: 'data:image/jpeg;base64,' + fRes.data, uploading: false })
          },
          fail: function() { that.setData({ uploading: false }) }
        })
      }
    })
  },

  // 保存菜品
  async saveDish() {
    var name = this.data.name
    if (!name || !name.trim()) {
      wx.showToast({ title: '请输入菜名', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    // 1. 如果有新选择的本地图片，先上传到云存储获取 fileID
    var imageFileIdForCheck = ''
    if (this.data.imageLocalPath) {
      wx.showLoading({ title: '上传图片...' })
      imageFileIdForCheck = await this.uploadImageToCloud(this.data.imageLocalPath)
      wx.hideLoading()
      if (!imageFileIdForCheck) {
        wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
        this.setData({ saving: false })
        return
      }
    } else if (this.data.imageFileId && this.data.imageFileId.indexOf('cloud://') === 0) {
      // 编辑模式，没有新图片，使用已有的云存储 fileID
      imageFileIdForCheck = this.data.imageFileId
    }

    // 2. 内容安全检测（文本 + 图片），使用云存储 fileID 检测图片
    var securityPassed = await this.checkContentSecurity(imageFileIdForCheck)
    if (!securityPassed) {
      this.setData({ saving: false })
      return
    }

    // 3. 图片数据：使用压缩后的 base64
    var imageBase64 = this.data.imageBase64 || ''
    if (!imageBase64 && this.data.imageFileId) {
      imageBase64 = this.data.imageFileId
    }

    var dishData = {
      name: name.trim(),
      category: this.data.category,
      price: parseFloat(this.data.price) || 0,
      description: this.data.description || '',
      imageBase64: imageBase64,
      imageFileId: imageFileIdForCheck,
      isActive: true
    }

    try {
      if (this.data.isEdit) {
        await this.updateDish(dishData, imageFileIdForCheck)
      } else {
        await this.addDish(dishData, imageFileIdForCheck)
      }
      // 标记需要重新同步，让其他页面强制拉取云端最新数据
      app.globalData.needRefresh = true
      wx.showToast({ title: '保存成功', icon: 'success' })
      var that = this
      setTimeout(function() {
        that.setData({ saving: false })
        wx.navigateBack({ fail: function(err) { console.warn('[荔枝荟] 返回失败:', err) } })
      }, 1000)
      return
    } catch (err) {
      console.error('[荔枝荟] 保存失败:', err)
      wx.showToast({ title: '保存失败: ' + (err.errMsg || err.message || ''), icon: 'none' })
    }
    this.setData({ saving: false })
  },

  // 内容安全检测（文本 + 图片）
  // imgFileId: 云存储文件ID，用于图片内容安全检测
  async checkContentSecurity(imgFileId) {
    if (!app.globalData.cloudReady) {
      // 云开发不可用时跳过检测，允许保存
      return true
    }

    var text = (this.data.name || '') + ' ' + (this.data.description || '')

    try {
      var res = await wx.cloud.callFunction({
        name: 'securityCheck',
        data: { text: text, imgFileId: imgFileId || '' }
      })

      var result = res.result || {}

      if (result.textResult === 'risky') {
        wx.showToast({ title: '内容含违规信息，请修改后重试', icon: 'none', duration: 2000 })
        return false
      }

      if (result.imgResult === 'risky') {
        wx.showToast({ title: '图片含违规信息，请更换后重试', icon: 'none', duration: 2000 })
        return false
      }

      // imgResult === 'checking' 表示异步检测中，允许先保存
      // imgResult === 'pass' 表示通过
      return true
    } catch (err) {
      // 安全检测接口异常时，不阻断用户操作，记录日志
      console.warn('[荔枝荟] 内容安全检测异常:', err.errMsg || err.message)
      return true
    }
  },

  // 上传图片到云存储（如果有新选择的本地图片）
  async uploadImageToCloud(tempFilePath) {
    if (!tempFilePath || !app.globalData.cloudReady) return ''
    try {
      var cloudPath = 'dishes/' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '.jpg'
      var res = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: tempFilePath
      })
      console.log('[荔枝荟] 图片上传云存储成功: ' + res.fileID)
      return res.fileID
    } catch (err) {
      console.warn('[荔枝荟] 图片上传云存储失败:', err.errMsg || err.message)
      return ''
    }
  },

  // 新增菜品（imageFileId 已在 saveDish 中上传好）
  async addDish(dishData, imageFileId) {
    var now = new Date().toISOString()
    dishData.createTime = now
    dishData.updateTime = now
    // 先生成本地ID
    dishData._id = 'dish_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)

    // 云数据库写入
    if (app.globalData.cloudReady && app.globalData.db) {
      try {
        var cloudData = {
          name: dishData.name,
          category: dishData.category,
          price: dishData.price,
          description: dishData.description,
          imageBase64: dishData.imageBase64 || '',
          imageFileId: imageFileId || '',
          isActive: true,
          createTime: now,
          updateTime: now
        }
        await app.globalData.db.collection('dishes').doc(dishData._id).set({ data: cloudData })
        console.log('[荔枝荟] 云端新增成功: ' + dishData.name)
      } catch (err) {
        console.warn('[荔枝荟] 云数据库写入失败，仅保存本地:', err.errMsg || err.message)
      }
    }

    // 始终同步本地 Storage
    dishData.imageFileId = imageFileId || ''
    var localDishes = wx.getStorageSync('dishes') || []
    localDishes.push(dishData)
    app.saveDishes(localDishes)
  },

  // 更新菜品（imageFileId 已在 saveDish 中上传好）
  async updateDish(dishData, imageFileId) {
    var id = this.data.dishId
    var now = new Date().toISOString()

    // 读取本地原始 createTime（保留不变）
    var localDishes = wx.getStorageSync('dishes') || []
    var originalCreateTime = now
    for (var i = 0; i < localDishes.length; i++) {
      if (localDishes[i]._id === id) {
        originalCreateTime = localDishes[i].createTime || now
        break
      }
    }

    // 云数据库：用 set 覆盖写入
    if (app.globalData.cloudReady && app.globalData.db) {
      try {
        var cloudData = {
          name: dishData.name,
          category: dishData.category,
          price: dishData.price,
          description: dishData.description,
          imageBase64: dishData.imageBase64 || '',
          imageFileId: imageFileId || '',
          isActive: true,
          createTime: originalCreateTime,
          updateTime: now
        }
        await app.globalData.db.collection('dishes').doc(id).set({ data: cloudData })
        console.log('[荔枝荟] 云端保存成功: ' + dishData.name)
      } catch (err) {
        console.warn('[荔枝荟] 云端保存失败，仅保存本地:', err.errMsg || err.message)
      }
    }

    // 同步本地 Storage（保留原始 createTime，更新 updateTime）
    var found = false
    for (var i = 0; i < localDishes.length; i++) {
      if (localDishes[i]._id === id) {
        localDishes[i].name = dishData.name
        localDishes[i].category = dishData.category
        localDishes[i].price = dishData.price
        localDishes[i].description = dishData.description
        localDishes[i].imageBase64 = dishData.imageBase64
        localDishes[i].imageFileId = imageFileId || localDishes[i].imageFileId
        localDishes[i].updateTime = now
        found = true
        break
      }
    }

    if (!found) {
      dishData._id = id
      dishData.createTime = now
      dishData.updateTime = now
      dishData.imageFileId = imageFileId || ''
      localDishes.push(dishData)
    }

    app.saveDishes(localDishes)
  },

  // 隐私协议：使用微信原生弹窗（系统级，永远在最顶层，不会被遮挡）
  showPrivacyModal() {
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
