# pi-model-inherit

[English](./README.md) | **简体中文**

pi 扩展，让 provider 和模型继承共享配置，不必重复写

```jsonc
{
  // 1. default 块：所有 provider 都继承的值
  "default": {
    "providers": {
      "*": { "compat": { "sendSessionAffinityHeaders": true } }
    }
  },
  "providers": {
    "my-gateway": {
      "baseUrl": "https://gateway.example/v1",
      "api": "openai-completions",
      "models": [
        // 2. inherit 字段：复制另一个模型的配置
        { "id": "glm-5.3", "inherit": "zai/glm-5.3" },
        // 也可以再覆盖个别字段
        { "id": "glm-5.3-fast", "inherit": "zai/glm-5.3", "maxTokens": 1000 }
      ]
    }
  }
}
```

## 安装

从 npmjs 安装：

```bash
pi install npm:pi-model-inherit
```

从 GitHub 安装：

```bash
pi install git:github.com/jalaxy33/pi-model-inherit
```

## 使用方法

### `default` 块

所有 provider 都继承的值。`"*"` 覆盖全部 provider，写具体的 provider id 则只作用于它。

```jsonc
{
  "default": {
    "providers": {
      "*": { "compat": { "sendSessionAffinityHeaders": true } },
      "my-gateway": { "headers": { "x-team": "core" } }
    }
  }
}
```

<!-- prettier-ignore -->
| 键 | 生效方式 |
|---|---|
| `compat`、`headers` | 在模型层和请求层注入。不重组任何 provider，也不写回你的文件。 |
| `name`、`baseUrl`、`apiKey`、`api`、`oauth`、`authHeader` | 命中的 provider 得到一份合成配置，等同于把这些键直接写在 `providers` 里。 |
| `models`、`modelOverrides` | 不支持：定义和覆盖不是默认值。 |

显式写的值永远优先，包括 `false`。对象型字段逐键合并，其余整体替换。

### `inherit` 字段

```jsonc
{ "id": "glm-5.3", "inherit": "zai/glm-5.3" }
```

- `inherit` 写要继承的 `"provider/modelId"`。
- 模型 `id` 必须提供。
- 字段值可覆盖（如 `"maxTokens": 1000`）
