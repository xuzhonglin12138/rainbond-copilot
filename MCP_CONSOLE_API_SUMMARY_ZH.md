# Rainbond Console MCP 工具总览（中文）

## 一、文档说明

本文档基于当前 `rainbond-console` 中的 `MCPQueryService` 代码整理，目标是把 **当前 MCP 服务对外可见的 51 个工具** 统一收敛成一份可读、可生成 skills 的参考资料。

本文档重点说明每个工具的：

- `工具名称`
- `功能简介`
- `可见性 / 权限`
- `对应 Console 接口`（如果有现成一对一路由）
- `核心实现`（MCP 直接调用的 console service / repository）

说明：

- 这里的 **51 个工具** 是指：**企业管理员视角**下，`tools/list` 当前可见的完整工具集。
- 普通用户默认看不到企业/集群管理相关的 9 个工具，所以普通用户默认可见工具数是 `42`。
- 另外还有少量兼容性保留的旧工具，当前 **不在默认 `tools/list` 中暴露**，这部分放在文档末尾附录中，不计入本文档的 51 个正式工具。

## 二、MCP 入口与调用方式

### 2.1 Streamable HTTP（推荐）

- `POST /console/mcp/query`
- `GET /console/mcp/query`
- `DELETE /console/mcp/query`

推荐：新客户端优先走这一套。

### 2.2 Legacy SSE（兼容保留）

- `GET /console/mcp/query/sse`
- `POST /console/mcp/query/message?session_id=<session_id>`

### 2.3 MCP 调用方式

统一通过：

- `tools/list`
- `tools/call(name=<tool_name>, arguments=<json>)`

## 三、工具总数与分层建议

### 3.1 当前正式可见工具

- 企业管理员：`51` 个
- 普通用户：`42` 个

### 3.2 Skill 生成建议

如果要基于本文档生成 skills，建议优先选择：

- 高层查询工具：`rainbond_get_component_summary`、`rainbond_get_component_logs`
- 高层配置工具：`rainbond_manage_component_envs`、`rainbond_manage_component_connection_envs`、`rainbond_manage_component_ports`、`rainbond_manage_component_storage`、`rainbond_manage_component_autoscaler`、`rainbond_manage_component_probe`、`rainbond_manage_component_dependency`
- 高层创建工具：`rainbond_create_component_from_source`、`rainbond_create_component_from_package`、`rainbond_create_component_from_image`、`rainbond_create_app_from_yaml`

不建议在 skill 中优先使用兼容性旧工具，详见文末附录。

## 四、工具清单（51 个）

### 4.1 用户 / 企业 / 集群类工具（10 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_get_current_user` | 全部用户 | 获取当前登录用户信息，并返回 `is_enterprise_admin`。 | `GET /console/users/details` | `MCPQueryService.get_current_user()` |
| `rainbond_query_enterprises` | 企业管理员 | 查询当前用户可访问的企业列表。 | `GET /console/enterprises` | `MCPQueryService.query_enterprises()` -> `_get_user_enterprises()` |
| `rainbond_query_regions` | 企业管理员 | 查询企业下集群列表，支持关键词和分页。 | `GET /console/enterprise/{enterprise_id}/regions` | `MCPQueryService.query_regions()` -> `region_services.get_enterprise_regions()` |
| `rainbond_get_region_detail` | 企业管理员 | 获取单个集群详情，支持补充扩展信息。 | `GET /console/enterprise/{enterprise_id}/regions/{region_id}` | `MCPQueryService.get_region_detail()` -> `_get_region_model()` / `_get_region_context()` |
| `rainbond_create_region` | 企业管理员 | 新增集群元数据。 | `POST /console/enterprise/{enterprise_id}/regions` | `MCPQueryService.create_region()` -> `region_services.add_region()` |
| `rainbond_update_region` | 企业管理员 | 更新集群元数据；会先读取当前完整信息，再合并更新字段。 | `PUT /console/enterprise/{enterprise_id}/regions/{region_id}` | `MCPQueryService.update_region()` -> `region_services.update_region()` |
| `rainbond_delete_region` | 企业管理员 | 删除集群元数据。 | `DELETE /console/enterprise/{enterprise_id}/regions/{region_id}` | `MCPQueryService.delete_region()` -> `region_services.del_by_region_id()` |
| `rainbond_query_region_nodes` | 企业管理员 | 查询集群节点列表及角色统计。 | `GET /console/enterprise/{enterprise_id}/regions/{region_name}/nodes` | `MCPQueryService.query_region_nodes()` -> `enterprise_services.get_nodes()` |
| `rainbond_get_region_node_detail` | 企业管理员 | 获取单个节点详情。 | `GET /console/enterprise/{enterprise_id}/regions/{region_name}/nodes/{node_name}` | `MCPQueryService.get_region_node_detail()` -> `enterprise_services.get_node_detail()` |
| `rainbond_query_region_rbd_components` | 企业管理员 | 查询集群内 Rainbond 平台组件状态。 | `GET /console/enterprise/{enterprise_id}/regions/{region_name}/rbd-components` | `MCPQueryService.query_region_rbd_components()` -> `enterprise_services.get_rbdcomponents()` |

### 4.2 团队 / 应用 / 组件查询类工具（8 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_query_teams` | 全部用户（按企业权限过滤） | 查询企业下团队列表。 | `GET /console/enterprise/{enterprise_id}/teams` | `MCPQueryService.query_teams()` -> `team_services.get_enterprise_teams()` |
| `rainbond_query_apps` | 全部用户（按企业权限过滤） | 查询企业下应用列表。 | `GET /console/enterprise/{enterprise_id}/apps` | `MCPQueryService.query_apps()` -> `group_repo.get_groups_by_tenant_ids()` |
| `rainbond_query_components` | 全部用户（按企业/团队权限过滤） | 查询指定应用下组件列表。 | `GET /console/enterprise/{enterprise_id}/app/{app_id}/components` | `MCPQueryService.query_components()` -> `group_service_relation_repo.get_services_by_group()` + `service_repo.get_services_by_service_ids()` |
| `rainbond_get_team_apps` | 团队用户 | 查询指定团队、指定集群下的应用列表。 | `GET /console/teams/{tenantName}/groups` | `MCPQueryService.get_team_apps()` -> `group_service.get_apps_list()` |
| `rainbond_get_app_detail` | 团队用户 | 获取应用详情，包含服务数、运行中服务数、资源汇总等。 | 无一对一路由；MCP 直接聚合应用与服务状态 | `MCPQueryService.get_app_detail()` -> `group_service.get_app_by_id()` + `group_service.get_group_services()` + `base_service.status_multi_service()` |
| `rainbond_get_component_summary` | 团队用户 | 获取组件聚合视图：基础信息、状态、资源、端口、环境变量、存储、探针、伸缩规则、最近事件。 | 无一对一路由；MCP 直接聚合多个组件接口 | `MCPQueryService.get_component_summary()` -> 组合 `detail/env/ports/volumes/mnt/probe/autoscaler/events` 相关 service |
| `rainbond_get_component_detail` | 团队用户 | 获取组件原始详情视图。 | `GET /console/teams/{tenantName}/apps/{serviceAlias}/detail` | `MCPQueryService.get_component_detail()` |
| `rainbond_get_component_logs` | 团队用户 | 获取组件日志。当前实现为：**先查 pods，再按 pod SSE 日志链路读取日志**。 | `GET /console/teams/{tenantName}/apps/{serviceAlias}/pods` + `GET /console/sse/v2/tenants/{tenantName}/services/{serviceAlias}/pods/{pod_name}/logs?region_name={region_name}&lines={lines}` | `MCPQueryService.get_component_logs()` -> `region_api.get_service_pods()` + `region_api.get_component_pod_log()` |

### 4.3 应用 / 组件运维类工具（7 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_delete_component` | 团队用户 | 删除指定组件。 | 相关界面动作：组件删除 | `MCPQueryService.delete_component()` -> `app_manage_service.delete()` |
| `rainbond_operate_app` | 团队用户 | 批量操作应用内组件，支持 `start / stop / upgrade / deploy`。 | `POST /console/teams/{tenantName}/groups/{group_id}/common_operation` | `MCPQueryService.operate_app()` -> `app_manage_service.batch_operations()` |
| `rainbond_change_component_image` | 团队用户 | 修改镜像类组件的镜像地址。 | 无一对一路由；MCP 直接改组件模型字段 | `MCPQueryService.change_component_image()` |
| `rainbond_horizontal_scale_component` | 团队用户 | 组件水平伸缩。 | `POST /console/teams/{tenantName}/apps/{serviceAlias}/horizontal` | `MCPQueryService.horizontal_scale_component()` -> `app_manage_service.horizontal_upgrade()` |
| `rainbond_vertical_scale_component` | 团队用户 | 组件垂直伸缩（内存 / CPU / GPU）。 | `POST /console/teams/{tenantName}/apps/{serviceAlias}/vertical` | `MCPQueryService.vertical_scale_component()` -> `app_manage_service.vertical_upgrade()` |
| `rainbond_close_apps` | 团队用户 | 批量停止某团队某集群下的组件。 | `POST /console/teams/{tenantName}/apps/close` | `MCPQueryService.close_apps()` -> `app_manage_service.batch_action()` |
| `rainbond_delete_app` | 团队用户 | 删除应用，属于高风险破坏性操作。 | `DELETE /console/teams/{tenantName}/groups/{app_id}` / `POST /console/teams/{tenantName}/apps/{serviceAlias}/delete`（界面相关删除入口） | `MCPQueryService.delete_app()` -> `group_service.delete_app()` |

### 4.4 组件配置管理类工具（7 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_manage_component_envs` | 团队用户 | 高层自定义环境变量工具；只处理 `custom envs (inner)` 与 `build envs`。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/envs`、`PUT/DELETE /console/teams/{tenantName}/apps/{serviceAlias}/envs/{env_id}`、`GET/PUT /console/teams/{tenantName}/apps/{serviceAlias}/build_envs` | `MCPQueryService.manage_component_envs()` -> `env_var_service` |
| `rainbond_manage_component_connection_envs` | 团队用户 | 高层组件连接信息工具；只处理 `connection envs (outer)`。 | 同样走 `envs` 路由，但只操作 `scope=outer` | `MCPQueryService.manage_component_connection_envs()` -> `env_var_service` |
| `rainbond_manage_component_ports` | 团队用户 | 高层端口管理工具，显式区分对内/对外：`enable_inner / enable_outer / disable_inner / disable_outer / enable_outer_only`。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/ports`、`PUT/DELETE /console/teams/{tenantName}/apps/{serviceAlias}/ports/{port}`、`PUT /console/teams/{tenantName}/apps/{serviceAlias}/tcp-ports/{port}` | `MCPQueryService.manage_component_ports()` -> `handle_component_ports()` -> `port_service` |
| `rainbond_manage_component_storage` | 团队用户 | 高层存储管理工具，统一处理 `volume` 与 `mnt`。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/volumes`、`PUT/DELETE /console/teams/{tenantName}/apps/{serviceAlias}/volumes/{volume_id}`、`GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/mnt`、`DELETE /console/teams/{tenantName}/apps/{serviceAlias}/mnt/{dep_vol_id}` | `MCPQueryService.manage_component_storage()` -> `volume_service` + `mnt_service` |
| `rainbond_manage_component_autoscaler` | 团队用户 | 高层自动伸缩管理工具，统一处理规则查看、创建、更新和伸缩记录。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/xparules`、`GET/PUT /console/teams/{tenantName}/apps/{serviceAlias}/xparules/{rule_id}`、`GET /console/teams/{tenantName}/apps/{serviceAlias}/xparecords` | `MCPQueryService.manage_component_autoscaler()` -> `autoscaler_service` + `scaling_records_service` |
| `rainbond_manage_component_probe` | 团队用户 | 高层探针管理工具，统一处理探针查看、新增、修改、删除。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/probe` | `MCPQueryService.manage_component_probe()` -> `probe_service` |
| `rainbond_manage_component_dependency` | 团队用户 | 高层依赖管理工具，统一处理依赖、反向依赖及可依赖组件查询。 | `GET/POST /console/teams/{tenantName}/apps/{serviceAlias}/dependency`、`GET /console/teams/{tenantName}/apps/{serviceAlias}/dependency-list`、`GET /console/teams/{tenantName}/apps/{serviceAlias}/dependency-reverse`、`DELETE /console/teams/{tenantName}/apps/{serviceAlias}/dependency/{dep_service_id}`、`GET /console/teams/{tenantName}/apps/{serviceAlias}/un_dependency` | `MCPQueryService.manage_component_dependency()` -> `dependency_service` |

### 4.5 创建 / 交付 / 升级 / 复制类工具（14 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_create_app` | 团队用户 | 创建应用。 | `POST /console/teams/{tenantName}/groups` | `MCPQueryService.create_app()` -> `group_service.create_app()` |
| `rainbond_create_component` | 团队用户 | 从镜像创建组件；属于旧的镜像创建入口。 | `POST /console/teams/{tenantName}/apps/docker_run` | `MCPQueryService.create_component()` -> `console_app_service.create_docker_run_app()` |
| `rainbond_create_component_from_image` | 团队用户 | 从镜像创建组件；推荐优先使用这一工具。 | `POST /console/teams/{tenantName}/apps/docker_run` | `MCPQueryService.create_component_from_image()` -> `create_component()` |
| `rainbond_create_component_from_source` | 团队用户 | 源码一键创建组件：自动识别仓库类型、检测、保存检测结果、默认配置、创建 region service、按需部署。 | 相关 console 创建入口：`POST /console/teams/{tenantName}/apps/source_code` | `MCPQueryService.create_component_from_source()` -> `source_component_service.auto_create_component()` |
| `rainbond_create_component_from_package` | 团队用户 | 软件包上传完成后的高层一键创建。 | 相关 console 创建入口：`POST /console/teams/{tenantName}/apps/package_build` | `MCPQueryService.create_component_from_package()` -> `package_component_service.auto_create_component()` |
| `rainbond_build_component` | 团队用户 | 构建 / 确认创建组件；会在需要时先创建 region service，再执行 deploy。 | `POST /console/teams/{tenantName}/apps/{serviceAlias}/build`、相关部署入口 `POST /console/teams/{tenantName}/apps/{serviceAlias}/deploy` | `MCPQueryService.build_component()` -> `console_app_service.create_region_service()` + `app_manage_service.deploy()` |
| `rainbond_create_app_from_yaml` | 团队用户 | 从 YAML / Compose 元数据创建应用检查任务。 | `POST /console/teams/{tenantName}/apps/docker_compose` | `MCPQueryService.create_app_from_yaml()` -> `compose_service.create_group_compose()` |
| `rainbond_check_yaml_app` | 团队用户 | 校验 YAML / Compose 应用。 | `POST /console/teams/{tenantName}/groups/{group_id}/check` | `MCPQueryService.check_yaml_app()` -> `compose_service.check_compose()` |
| `rainbond_get_yaml_app_check_result` | 团队用户 | 获取 YAML 检测结果并落库，生成组件列表。 | 无一对一路由；相关构建入口为 `POST /console/teams/{tenantName}/groups/{group_id}/compose_build` | `MCPQueryService.get_yaml_app_check_result()` -> `app_check_service.get_service_check_info()` + `compose_service.save_compose_services()` |
| `rainbond_get_app_upgrade_info` | 团队用户 | 查询应用内可升级的市场应用模型信息。 | `GET /console/teams/{tenantName}/groups/{group_id}/upgrade-info` | `MCPQueryService.get_app_upgrade_info()` -> `market_app_service.get_market_apps_in_app()` |
| `rainbond_upgrade_app` | 团队用户 | 直接执行应用升级流程。 | 无一对一路由；相关升级界面入口为 `GET /.../upgrade-info`、`POST /.../upgrade-records/{record_id}/upgrade` | `MCPQueryService.upgrade_app()` -> `upgrade_service.openapi_upgrade_app_models()` |
| `rainbond_get_copy_app_info` | 团队用户 | 获取复制应用前需要的组件元数据。 | 相关复制入口：`POST /console/teams/{tenantName}/groupapp/{group_id}/copy` | `MCPQueryService.get_copy_app_info()` -> `groupapp_copy_service.get_group_services_with_build_source()` |
| `rainbond_copy_app` | 团队用户 | 复制应用组件到目标团队 / 集群 / 应用。 | `POST /console/teams/{tenantName}/groupapp/{group_id}/copy` | `MCPQueryService.copy_app()` -> `groupapp_copy_service.copy_group_services()` |
| `rainbond_install_app_by_market` | 团队用户 | 从市场安装应用组件到现有应用。 | `POST /console/teams/{tenantName}/apps/market_create` | `MCPQueryService.install_app_by_market()` -> `app_market_service` + `market_app_service.install_service()` |

### 4.6 监控 / 网关 / Helm 类工具（5 个）

| 工具名称 | 可见性 | 功能简介 | 对应 Console 接口 | 核心实现 |
| --- | --- | --- | --- | --- |
| `rainbond_query_app_monitor` | 团队用户 | 查询应用下组件的实时监控数据。 | `GET /console/teams/{tenantName}/groups/{group_id}/monitor/batch_query`（应用维度）以及组件维度 `GET /console/teams/{tenantName}/apps/{serviceAlias}/monitor/query` | `MCPQueryService.query_app_monitor()` -> `region_api.get_query_data()` |
| `rainbond_query_app_monitor_range` | 团队用户 | 查询应用下组件的历史监控数据。 | `GET /console/teams/{tenantName}/apps/{serviceAlias}/monitor/query_range`、应用维度批量查询由 MCP 直接聚合实现 | `MCPQueryService.query_app_monitor_range()` -> `region_api.get_query_range_data()` |
| `rainbond_create_gateway_rules` | 团队用户 | 创建 HTTP / TCP 网关规则。 | `POST /console/teams/{tenantName}/httpdomain`、`POST /console/teams/{tenantName}/tcpdomain`、相关查询/网关配置入口位于 `domain`/`visit` 路由组 | `MCPQueryService.create_gateway_rules()` -> `domain_service` + `port_service` + `region_api.api_gateway_bind_http_domain()` |
| `rainbond_check_helm_app` | 团队用户 | Helm 应用安装前检查。 | 相关 Helm 入口：`POST /console/teams/{team_name}/helm_app` | `MCPQueryService.check_helm_app()` -> `helm_app_service.check_helm_app()` |
| `rainbond_build_helm_app` | 团队用户 | 生成 Helm 应用模板并写入当前应用。 | 相关 Helm 入口：`POST /console/teams/{team_name}/helm_app`、`POST /console/teams/{team_name}/helm_command` | `MCPQueryService.build_helm_app()` -> `helm_app_service.yaml_conversion()` + `helm_app_service.generate_template()` |

## 五、当前不在 51 个正式工具中的兼容性旧工具（6 个）

以下工具代码仍然保留、`call_tool` 仍可兼容调用，但当前 **不会默认出现在 `tools/list` 中**，因此不建议在 skill 中优先使用：

| 工具名称 | 当前状态 | 说明 |
| --- | --- | --- |
| `rainbond_get_component_events` | 隐藏 | 已被 `rainbond_get_component_summary` 中的 `recent_events` 覆盖；需要独立分页事件时才有价值。 |
| `rainbond_update_component_envs` | 隐藏 | 已被 `rainbond_manage_component_envs` 取代。 |
| `rainbond_handle_component_ports` | 隐藏 | 已被 `rainbond_manage_component_ports` 取代。 |
| `rainbond_bind_component_volume` | 隐藏 | 已被 `rainbond_manage_component_storage` 取代。 |
| `rainbond_check_component` | 隐藏 | 源码/软件包创建底层检测步骤；当前高层一键创建工具已封装。 |
| `rainbond_get_component_check_result` | 隐藏 | 对应底层检测结果查询步骤；当前高层一键创建工具已封装。 |

## 六、建议用于生成 Skills 的高层工具集合

如果要基于本文档生成对话型 skills，建议按下面这组高层工具优先建模：

### 6.1 组件查询与排障

- `rainbond_get_component_summary`
- `rainbond_get_component_detail`
- `rainbond_get_component_logs`

### 6.2 组件配置修改

- `rainbond_manage_component_envs`
- `rainbond_manage_component_connection_envs`
- `rainbond_manage_component_ports`
- `rainbond_manage_component_storage`
- `rainbond_manage_component_autoscaler`
- `rainbond_manage_component_probe`
- `rainbond_manage_component_dependency`

### 6.3 应用与组件生命周期

- `rainbond_create_app`
- `rainbond_create_component_from_image`
- `rainbond_create_component_from_source`
- `rainbond_create_component_from_package`
- `rainbond_create_app_from_yaml`
- `rainbond_build_component`
- `rainbond_delete_component`
- `rainbond_delete_app`
- `rainbond_operate_app`
- `rainbond_close_apps`

### 6.4 应用升级 / 复制 / 市场 / Helm

- `rainbond_get_app_upgrade_info`
- `rainbond_upgrade_app`
- `rainbond_get_copy_app_info`
- `rainbond_copy_app`
- `rainbond_install_app_by_market`
- `rainbond_check_helm_app`
- `rainbond_build_helm_app`

### 6.5 企业与集群管理

- `rainbond_query_enterprises`
- `rainbond_query_regions`
- `rainbond_get_region_detail`
- `rainbond_create_region`
- `rainbond_update_region`
- `rainbond_delete_region`
- `rainbond_query_region_nodes`
- `rainbond_get_region_node_detail`
- `rainbond_query_region_rbd_components`

## 七、代码入口

- MCP 工具定义与实现：`rainbond-console/console/services/mcp_query_service.py`
- MCP 传输视图：`rainbond-console/console/views/mcp_query.py`
- MCP 路由：`rainbond-console/console/urls.py`
- Region API Client：`rainbond-console/www/apiclient/regionapi.py`
- 源码一键创建聚合 service：`rainbond-console/console/services/source_component_service.py`
- 软件包一键创建聚合 service：`rainbond-console/console/services/package_component_service.py`

## 八、按主题拆分 Skills 的建议

下面这部分不是 MCP 实现本身，而是为了让你后续基于本文档生成 skills 时更顺手。建议不要把 51 个工具一次性塞进一个 skill，而是按使用场景拆分。

### 8.1 企业与集群管理 Skill

**建议 skill 名称**

- `rainbond-enterprise-cluster-admin`

**适用场景**

- 查询企业
- 查询集群
- 管理集群元数据
- 查询节点与 Rainbond 平台组件

**推荐工具**

- `rainbond_get_current_user`
- `rainbond_query_enterprises`
- `rainbond_query_regions`
- `rainbond_get_region_detail`
- `rainbond_create_region`
- `rainbond_update_region`
- `rainbond_delete_region`
- `rainbond_query_region_nodes`
- `rainbond_get_region_node_detail`
- `rainbond_query_region_rbd_components`

**推荐调用顺序**

1. `rainbond_get_current_user`
2. `rainbond_query_enterprises`
3. `rainbond_query_regions`
4. 如需详情再调用 `rainbond_get_region_detail`
5. 写操作再调用 `create/update/delete`

**Skill 提示建议**

- 先确认当前用户是否是企业管理员。
- 如果不是企业管理员，不要尝试调用集群与企业工具。
- 修改和删除集群前，先查询详情再执行操作。

### 8.2 企业资源查询 Skill

**建议 skill 名称**

- `rainbond-enterprise-resource-query`

**适用场景**

- 查询团队
- 查询企业下应用
- 查询企业下组件

**推荐工具**

- `rainbond_query_teams`
- `rainbond_query_apps`
- `rainbond_query_components`

**推荐调用顺序**

1. `rainbond_query_teams`
2. `rainbond_query_apps`
3. `rainbond_query_components`

**Skill 提示建议**

- 先根据 `enterprise_id` 缩小范围。
- 优先使用 `query` 关键字过滤，减少返回量。

### 8.3 应用查询与概览 Skill

**建议 skill 名称**

- `rainbond-app-overview`

**适用场景**

- 查询团队下应用
- 获取应用详情

**推荐工具**

- `rainbond_get_team_apps`
- `rainbond_get_app_detail`

**推荐调用顺序**

1. `rainbond_get_team_apps`
2. `rainbond_get_app_detail`

**Skill 提示建议**

- 查询应用列表时，优先使用 `team_name + region_name`。
- 进入应用后，再基于 `app_id` 查询详情。

### 8.4 组件查询与排障 Skill

**建议 skill 名称**

- `rainbond-component-observability`

**适用场景**

- 组件信息聚合查询
- 组件原始详情查询
- 组件日志排障

**推荐工具**

- `rainbond_get_component_summary`
- `rainbond_get_component_detail`
- `rainbond_get_component_logs`

**推荐调用顺序**

1. `rainbond_get_component_summary`
2. 如需原始字段再调用 `rainbond_get_component_detail`
3. 如需排障再调用 `rainbond_get_component_logs`

**Skill 提示建议**

- 优先先查 `summary`，不要直接拉日志。
- 查询日志时优先用 `action=service`，由 MCP 自动先查 pods 再选实例。
- 如果要精确定位某个实例，再用 `action=container + pod_name`。

### 8.5 组件配置管理 Skill

**建议 skill 名称**

- `rainbond-component-config`

**适用场景**

- 修改环境变量
- 修改组件连接信息
- 修改端口
- 修改存储
- 修改探针
- 修改依赖
- 修改自动伸缩

**推荐工具**

- `rainbond_manage_component_envs`
- `rainbond_manage_component_connection_envs`
- `rainbond_manage_component_ports`
- `rainbond_manage_component_storage`
- `rainbond_manage_component_autoscaler`
- `rainbond_manage_component_probe`
- `rainbond_manage_component_dependency`

**关键约束**

- `rainbond_manage_component_envs` 只处理自定义环境变量和构建环境变量，不处理连接信息。
- `rainbond_manage_component_connection_envs` 只处理组件连接信息，不处理自定义环境变量。
- 端口工具优先使用高层动作：
  - `enable_inner`
  - `disable_inner`
  - `enable_outer`
  - `disable_outer`
  - `enable_outer_only`

**Skill 提示建议**

- 修改前先用各自的 `summary` 操作读取现状。
- 修改时只动必要字段，不要同时混多个类型。
- 避免把 `custom envs` 和 `connection envs` 混在一个请求里。

### 8.6 组件生命周期 Skill

**建议 skill 名称**

- `rainbond-component-lifecycle`

**适用场景**

- 删除组件
- 批量操作应用组件
- 改镜像
- 水平 / 垂直伸缩
- 批量关闭组件

**推荐工具**

- `rainbond_delete_component`
- `rainbond_operate_app`
- `rainbond_change_component_image`
- `rainbond_horizontal_scale_component`
- `rainbond_vertical_scale_component`
- `rainbond_close_apps`

**Skill 提示建议**

- 高风险操作前，先调用查询类工具确认目标组件或应用。
- `operate_app` 适合批量动作，不适合做精细配置修改。

### 8.7 应用创建与交付 Skill

**建议 skill 名称**

- `rainbond-app-delivery`

**适用场景**

- 创建应用
- 镜像创建组件
- 源码一键创建组件
- 软件包一键创建组件
- YAML / Compose 创建应用
- 构建组件

**推荐工具**

- `rainbond_create_app`
- `rainbond_create_component`
- `rainbond_create_component_from_image`
- `rainbond_create_component_from_source`
- `rainbond_create_component_from_package`
- `rainbond_create_app_from_yaml`
- `rainbond_check_yaml_app`
- `rainbond_get_yaml_app_check_result`
- `rainbond_build_component`

**关键约束**

- 源码创建优先用 `rainbond_create_component_from_source`，不要再拆成低层检测工具。
- 软件包创建优先用 `rainbond_create_component_from_package`，前提是已完成上传且拿到 `event_id`。
- YAML 创建按三步：
  1. `rainbond_create_app_from_yaml`
  2. `rainbond_check_yaml_app`
  3. `rainbond_get_yaml_app_check_result`

### 8.8 应用升级 / 复制 / 市场 / Helm Skill

**建议 skill 名称**

- `rainbond-app-evolution`

**适用场景**

- 应用升级
- 应用复制
- 市场安装
- Helm 检查与模板生成

**推荐工具**

- `rainbond_get_app_upgrade_info`
- `rainbond_upgrade_app`
- `rainbond_get_copy_app_info`
- `rainbond_copy_app`
- `rainbond_install_app_by_market`
- `rainbond_check_helm_app`
- `rainbond_build_helm_app`

**Skill 提示建议**

- 升级前先查 `rainbond_get_app_upgrade_info`
- 复制前先查 `rainbond_get_copy_app_info`
- Helm 先查 `rainbond_check_helm_app`，再执行 `rainbond_build_helm_app`

### 8.9 监控与网关 Skill

**建议 skill 名称**

- `rainbond-observability-gateway`

**适用场景**

- 实时监控
- 历史监控
- 创建网关规则

**推荐工具**

- `rainbond_query_app_monitor`
- `rainbond_query_app_monitor_range`
- `rainbond_create_gateway_rules`

**Skill 提示建议**

- 监控查询先确认 `app_id`
- 网关规则创建前先确认目标端口已存在且外部访问策略符合预期

## 九、用于生成 Skills 的统一约束建议

后续如果你要把这份文档转换成 skill，可以把下面这些约束直接写进 skill 提示词。

### 9.1 通用规则

- 先查再改，除非用户明确要求直接执行。
- 优先使用高层工具，不优先使用兼容性旧工具。
- 如果用户意图不明确，先收集最小必要参数，不要盲目执行写操作。
- 对删除、升级、复制、批量操作这类高风险动作，先向用户复述目标。

### 9.2 查询规则

- 组件问题优先：
  1. `rainbond_get_component_summary`
  2. `rainbond_get_component_detail`
  3. `rainbond_get_component_logs`
- 应用问题优先：
  1. `rainbond_get_team_apps`
  2. `rainbond_get_app_detail`

### 9.3 环境变量规则

- 自定义环境变量只用：`rainbond_manage_component_envs`
- 组件连接信息只用：`rainbond_manage_component_connection_envs`
- 不要混用这两个工具

### 9.4 端口规则

- 不让模型直接猜底层 `action`
- 统一使用高层 `operation`
- 推荐顺序：
  1. `summary`
  2. `add`
  3. `enable_inner / enable_outer`
  4. `update_protocol / update_alias`
  5. `delete`

### 9.5 日志规则

- 默认优先 `action=service`
- 由 MCP 自动：
  1. 查 pods
  2. 选可用 pod
  3. 基于 pod SSE 读取日志
- 只有用户明确指定实例时，再使用 `action=container`

## 十、Skill 生成时建议保留的字段

如果你后面把这份文档转换成 JSON / YAML / skill prompt，建议每个工具至少保留这些字段：

- `name`
- `category`
- `visibility`
- `purpose`
- `console_api`
- `core_impl`
- `risk_level`
- `recommended_before`
- `recommended_after`
- `notes`

推荐的 `risk_level` 取值：

- `low`
- `medium`
- `high`
- `destructive`

例如：

- 查询类：`low`
- 修改配置类：`medium`
- 升级 / 复制 / 市场安装：`high`
- 删除类：`destructive`
