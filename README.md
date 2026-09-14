# 果蝇中枢 DJ / Fly DJ

在浏览器里跑通的科学×艺术演示：用 **FlyEM MaleCNS v1.0 官方连接组** 做冻结解剖 CSR，音频特征经可训练感觉编码器注入分型神经元池，Web Worker 上跑冻结 LIF，读出进入可训练策略头，策略再驱动真实 Web Audio 打碟台。旁边是官方中枢壳体 + 胞体热力，以及一只高对比、带打碟手势的三维果蝇 DJ。

## 冻结 vs 训练

| 部分 | 状态 | 说明 |
| --- | --- | --- |
| MaleCNS 突触边权 CSR | **冻结** | 官方 `connectome-weights-male-cns-v1.0-minconf-0.5.feather`（MD5 `f30e9dcca25cfd021bf1e7b3d975599e`），只保留 **weight≥3 且两端都有 type** 的边。从不编造突触。 |
| 胞体 / 类型 / 壳体 | **冻结** | 官方 annotations + CB / OL(L) / OL(R) / VNC neuropil shell |
| 感觉编码器 | **可训练** | 8 维音频特征 → 分型池注入电流（带噪声，REINFORCE） |
| 通路增益 | **可训练（可选）** | 每个 pool 一个标量，乘在该池突触输出上；**不改 CSR 边** |
| 策略头 | **可训练** | 池平均发放 + 音频 → 交叉推子 / 滤波 / 低频 EQ / 主音量 / punch |
| LIF 动力学 | **冻结超参** | 阈值、漏电、不应期固定 |

HUD 数字来自 `public/data/manifest.json`：**164506** 个 typed 节点，**10349880**（≈10.3M）条边。

## 训练旋钮 / Train panel

旋钮写在界面状态里（并缓存在 `localStorage`），不改 CSR：

| 旋钮 | 作用 |
| --- | --- |
| 学习率 LR | REINFORCE / 教师模仿步长 |
| 噪声 noise | 策略与编码器采样标准差倍率 |
| 动作增益 gain | 把推子拉离中点，让动作听得见 |
| 批大小 batch | 每 N 步再更新一次 |
| 能量 / 抗削波 / 抗静音 / 节拍 | 奖励各项权重 |
| 教师塑形 teacher | 贴近「大交叉、滤波扫、拍点冲击」的教师动作 |

**快速训练 / Quick Train**（约 50 秒）：自动切到更高增益 + 更强教师塑形 + 大学习率，让策略在几十秒内学会能听出来的扫频和交叉。奖励滑动平均越过阈值后解锁 **展示打碟 / Showcase**。

## 怎么听出「会打碟」

1. `npm install` 后 `npm run dev`（端口 **47301**）。
2. 等 CSR 解压完成（gzip ≈31 MB）。
3. 点 **开始演出 / Start the set**（浏览器必须有一次用户手势才能响）。
4. 点 **快速训练 / Quick Train**，看回合、奖励 MA、优势曲线、各推子 **Δ last 1s**、高注入感觉池。
5. 结束后点 **展示打碟 / Showcase**：先 8 秒启发式对照，再 8 秒训练后策略（动作被夸张）。屏幕会打出「交叉推到 B 盘 / open filter」等字幕。
6. **验收**：Showcase 的交叉、滤波、主音量/冲击应在约 10 秒内和 **随机 Random** 听出差别——随机是小步游走，训练后是扫盘和拍点泵。

对照：随机不更新权重；启发式只做频谱映射。

算法是 **REINFORCE + 滑动基线 + 可选教师模仿**。只训练编码器、增益、策略头。

## 现场面板

- **连接组**：胞体热力按发放率百分位上色；Raster 带 colorbar；类型行在饱和时标 `sat` 并给 Δ / z。相机随 meanRate 轻微公转/脉动。
- **DJ 台**：果蝇为深色甲壳 + 青/品红描边、大红复眼、透光蓝翅、金色腹纹、可见足。前足伸向 A/B 唱盘与交叉推子；交叉时身体倾斜，滤波时扭转，冲击时点头+振翅。

## 本地运行

```bash
npm install
npm run dev          # http://127.0.0.1:47301
npm run build        # 生产构建必须通过
```

## 数据重建（可选）

仓库已带剪枝后的 `public/data/weights.csr.bin.gz`，**不要**把 1.1 GB feather 或未压缩 ~83 MB CSR 提交进去。

```bash
# 官方 feather（先校验 MD5）
curl -L -o /tmp/malecns/connectome-weights-male-cns-v1.0-minconf-0.5.feather \
  https://storage.googleapis.com/flyem-male-cns/v1.0/connectome-data/flat-connectome/connectome-weights-male-cns-v1.0-minconf-0.5.feather
python3 scripts/prune_malecns.py
python3 scripts/fetch_shells.py
python3 scripts/generate_beds.py
```

## 诚实说明

这不是生物真实放电。壳体与边权来自 Janelia FlyEM MaleCNS v1.0（请遵循上游数据使用规范）。LIF 是示意动力学；奖励是打碟代理，不是行为学实验。
