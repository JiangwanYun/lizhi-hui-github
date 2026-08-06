Component({
  data: {
    selected: 0,
    list: [
      {
        pagePath: "/pages/index/index",
        text: "菜单",
        icon: "📋",
        iconActive: "📋"
      },
      {
        pagePath: "/pages/order/order",
        text: "点单",
        icon: "✏️",
        iconActive: "✅"
      },
      {
        pagePath: "/pages/weekly/weekly",
        text: "周报",
        icon: "📅",
        iconActive: "📅"
      },
      {
        pagePath: "/pages/dish-manage/dish-manage",
        text: "管理",
        icon: "⚙️",
        iconActive: "⚙️"
      }
    ]
  },
  methods: {
    switchTab(e) {
      const data = e.currentTarget.dataset
      const url = data.path
      wx.switchTab({ url })
    }
  }
})
