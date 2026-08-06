const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const { text, imgFileId } = event

  console.log('[securityCheck] 收到检测请求, text长度:', text ? text.length : 0, ', imgFileId:', imgFileId || '(无)')

  var result = {
    textResult: 'pass',
    imgResult: 'pass',
    imgTraceId: ''
  }

  // 1. 文本内容安全检测
  if (text && text.trim()) {
    try {
      var textRes = await cloud.openapi.security.msgSecCheck({
        content: text.trim()
      })
      console.log('[securityCheck] 文本检测结果 errCode:', textRes.errCode)
      // errCode === 0 表示通过，87014 表示含违规内容
      if (textRes.errCode === 87014) {
        result.textResult = 'risky'
        console.log('[securityCheck] 文本检测: 违规')
      }
    } catch (err) {
      if (err.errCode === 87014) {
        result.textResult = 'risky'
        console.log('[securityCheck] 文本检测: 违规(异常捕获)')
      } else {
        console.warn('[securityCheck] 文本检测异常:', err.errCode, err.errMsg)
      }
    }
  }

  // 文本已违规，直接返回，不再检测图片
  if (result.textResult === 'risky') {
    return result
  }

  // 2. 图片内容安全检测（异步接口）
  if (imgFileId && imgFileId.indexOf('cloud://') === 0) {
    try {
      // 先获取图片临时 URL
      var urlRes = await cloud.getTempFileURL({
        fileList: [imgFileId]
      })
      var imgUrl = ''
      if (urlRes.fileList && urlRes.fileList.length > 0 && urlRes.fileList[0].status === 0) {
        imgUrl = urlRes.fileList[0].tempFileURL
      }

      if (imgUrl) {
        console.log('[securityCheck] 开始图片检测, URL长度:', imgUrl.length)
        var imgRes = await cloud.openapi.security.mediaCheckAsync({
          media_url: imgUrl,
          media_type: 2,
          version: 2,
          openid: cloud.getWXContext().OPENID,
          scene: 3
        })
        result.imgResult = 'checking'
        result.imgTraceId = imgRes.traceId || ''
        console.log('[securityCheck] 图片检测已提交, traceId:', result.imgTraceId)
      } else {
        console.warn('[securityCheck] 获取图片临时URL失败')
      }
    } catch (err) {
      console.warn('[securityCheck] 图片检测异常:', err.errCode, err.errMsg)
      // 图片检测异常不阻断，标记为 checking
      result.imgResult = 'checking'
    }
  } else if (imgFileId) {
    console.log('[securityCheck] imgFileId 不是 cloud:// 格式，跳过图片检测:', imgFileId.substring(0, 20))
  }

  console.log('[securityCheck] 最终结果:', JSON.stringify(result))
  return result
}
