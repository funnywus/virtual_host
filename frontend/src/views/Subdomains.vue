<template>
  <div class="card">
    <div class="page-header">
      <div class="header-top">
        <span class="page-title">
          子域名列表
          <el-tag v-if="currentDomain" type="info" size="small" class="domain-filter-tag">{{ currentDomain.domain }}</el-tag>
        </span>
        <div class="header-actions">
          <el-dropdown v-if="selectedRows.length > 0" trigger="click">
            <el-button type="warning" size="small">
              批量操作 ({{ selectedRows.length }})<el-icon class="el-icon--right"><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="batchSetStatus('used')">批量设为已使用</el-dropdown-item>
                <el-dropdown-item @click="batchSetStatus('unused')">批量设为未使用</el-dropdown-item>
                <el-dropdown-item @click="batchSetStatus('disabled')">批量停用</el-dropdown-item>
                <el-dropdown-item divided @click="openBatchRenewDialog">批量调整时长</el-dropdown-item>
                <el-dropdown-item divided @click="batchDelete" style="color:#f56c6c">批量删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" @click="loadData" :loading="loading"><el-icon><Refresh /></el-icon></el-button>
          <el-button type="primary" size="small" @click="openDialog()">添加子域名</el-button>
          <el-button type="success" size="small" @click="openBatchDialog">批量生成</el-button>
          <el-button size="small" @click="batchDeployUploadScript" :loading="deployingScript">补发直传脚本</el-button>
        </div>
      </div>
      <div class="filter-bar">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索域名、记录值、服务器..."
          clearable
          class="filter-search"
          size="small"
          @change="onFilterChange"
          @clear="onFilterChange"
          @keyup.enter="onFilterChange"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select v-model="filterDomainId" placeholder="主域名" clearable class="filter-select" size="small" @change="onFilterChange">
          <el-option v-for="d in activeDomains" :key="d.id" :label="d.domain" :value="d.id" />
        </el-select>
        <el-select v-model="filterServerId" placeholder="服务器" clearable class="filter-select filter-select-wide" size="small" @change="onFilterChange">
          <el-option v-for="s in availableServers" :key="s.id" :label="`${s.name} (${s.ip})`" :value="s.id" />
        </el-select>
        <el-select v-model="filterStatus" placeholder="使用状态" clearable class="filter-select filter-select-narrow" size="small" @change="onFilterChange">
          <el-option label="未使用" value="unused" />
          <el-option label="已使用" value="used" />
          <el-option label="已停用" value="disabled" />
        </el-select>
        <div class="filter-checks">
          <el-checkbox v-model="filterExpiringSoon" size="small" border @change="onFilterChange">快过期</el-checkbox>
          <el-checkbox v-model="filterExpired" size="small" border @change="onFilterChange">已过期</el-checkbox>
        </div>
      </div>
    </div>
    <el-table :data="dataStore.subdomains" stripe size="small" class="subdomain-table" @selection-change="onSelectionChange">
      <el-table-column type="selection" width="45" />
      <el-table-column label="域名信息" min-width="280">
        <template #default="{ row }">
          <div class="domain-cell">
            <div class="domain-primary">
              <a v-if="row.ftp_auth_code" :href="getUploadUrl(row)" target="_blank" class="full-domain">{{ row.subdomain }}.{{ row.main_domain }}</a>
              <span v-else class="full-domain is-static">{{ row.subdomain }}.{{ row.main_domain }}</span>
            </div>
            <div class="domain-secondary">
              <el-tag size="small" type="info">{{ row.record_type }}</el-tag>
              <el-tooltip :content="row.record_value || '-'" placement="top" :show-after="400">
                <span class="meta-text">{{ row.record_value || '-' }}</span>
              </el-tooltip>
              <span class="meta-divider">·</span>
              <span class="server-text" :class="{ 'is-unbound': !row.server_name }">
                {{ row.server_name || '未绑定服务器' }}
              </span>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <div class="status-cell">
            <el-tag :type="getUseStatusType(row.use_status)" size="small">{{ getUseStatusText(row.use_status) }}</el-tag>
            <el-tag :type="row.status === 'active' ? 'success' : row.status === 'dns_error' ? 'danger' : 'warning'" size="small">
              DNS: {{ getDnsStatusText(row.status) }}
            </el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="有效期" width="180">
        <template #default="{ row }">
          <template v-if="row.expire_at">
            <div class="expire-cell">
              <span :class="getExpireClass(row.expire_at)">
                {{ isExpired(row.expire_at) ? '已过期' : '剩余 ' + getRemainingDays(row.expire_at) + ' 天' }}
              </span>
              <span class="expire-date">{{ formatDateShort(row.expire_at) }}</span>
            </div>
          </template>
          <span v-else style="color:#999;font-size:12px">-</span>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120">
        <template #default="{ row }">
          <el-tooltip v-if="row.remark" :content="row.remark" placement="top">
            <span class="remark-text" @dblclick="openRemarkDialog(row)">{{ row.remark }}</span>
          </el-tooltip>
          <span v-else style="color:#999;cursor:pointer" @dblclick="openRemarkDialog(row)">-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <div class="row-actions">
            <el-button v-if="row.ftp_auth_code" type="primary" size="small" @click="handleShare(row)">分享</el-button>
            <el-button type="warning" size="small" @click="openRenewDialog(row)">续费</el-button>
            <el-button type="info" size="small" @click="openStatusDialog(row)">状态</el-button>
            <el-dropdown trigger="click" class="more-actions">
            <el-button size="small">更多<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openFtpInfoDialog(row)">FTP 信息</el-dropdown-item>
                <el-dropdown-item @click="checkDirectUpload(row)">检测直传</el-dropdown-item>
                <el-dropdown-item @click="openNginxDialog(row)">Nginx 配置</el-dropdown-item>
                <el-dropdown-item @click="openRateLimitDialog(row)">限流配置</el-dropdown-item>
                <el-dropdown-item @click="openRemarkDialog(row)">修改备注</el-dropdown-item>
                <el-dropdown-item @click="openDialog(row)">编辑</el-dropdown-item>
                <el-dropdown-item v-if="row.use_status !== 'disabled'" @click="handleDisable(row)">停用</el-dropdown-item>
                <el-dropdown-item v-if="row.use_status === 'disabled'" @click="handleEnable(row)">启用</el-dropdown-item>
                <el-dropdown-item divided @click="handleDelete(row)" style="color:#f56c6c">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          </div>
        </template>
      </el-table-column>
    </el-table>

    <!-- 分页 -->
    <div style="margin-top:15px;display:flex;justify-content:flex-end">
      <el-pagination
        :current-page="currentPage"
        :page-size="pageSize"
        :page-sizes="[10, 20, 50, 100]"
        :total="dataStore.subdomainsTotal"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="onSizeChange"
        @current-change="onPageChange"
      />
    </div>

    <!-- 添加/编辑对话框 -->
    <AppDialog v-model="dialogVisible" :title="form.id ? '编辑子域名' : '添加子域名'" width="550px" :loading="saving" @confirm="handleSave">
      <el-form :model="form" label-width="110px">
        <el-form-item label="主域名">
          <el-select v-model="form.domain_id" placeholder="选择主域名" style="width:100%" :disabled="!!form.id">
            <el-option v-for="d in activeDomains" :key="d.id" :value="d.id" :label="d.domain + (d.is_default === 1 ? ' (默认)' : '')">
              <div class="domain-option">
                <span>{{ d.domain }}{{ d.is_default === 1 ? ' (默认)' : '' }}</span>
                <span v-if="parseTags(d.tags).length" class="domain-option-tags">
                  <el-tag v-for="tag in parseTags(d.tags)" :key="tag" :style="getTagStyle(tag)" size="small">{{ tag }}</el-tag>
                </span>
              </div>
            </el-option>
          </el-select>
          <div v-if="formDomainFilterTags.length" class="server-tag-hint">
            匹配标签：{{ formDomainFilterTags.join('、') }}
          </div>
        </el-form-item>
        <el-form-item label="子域名">
          <div style="display:flex;align-items:center;width:100%">
            <el-input v-model="form.subdomain" placeholder="例如: lyxxxx" :disabled="!!form.id" style="flex:1">
              <template #append v-if="form.domain_id">.{{ dataStore.domains.find(d => d.id === form.domain_id)?.domain }}</template>
            </el-input>
            <el-button v-if="!form.id" type="primary" @click="refreshSubdomain" style="margin-left:10px" :loading="refreshing">随机生成</el-button>
          </div>
        </el-form-item>
        <el-form-item label="生成规则" v-if="!form.id">
          <div style="display:flex;gap:8px;align-items:center">
            <el-input v-model="form.prefix" placeholder="前缀" style="width:70px" size="small" />
            <span style="color:#999;font-size:12px">+随机+</span>
            <el-input v-model="form.suffix" placeholder="后缀" style="width:70px" size="small" />
            <span style="color:#999;font-size:12px">总长</span>
            <el-input-number v-model="form.subdomain_length" :min="3" :max="20" size="small" style="width:90px" />
          </div>
        </el-form-item>
        <el-form-item label="服务器" v-if="form.record_type === 'A'">
          <el-select v-model="form.server_id" placeholder="选择服务器" clearable style="width:100%" @change="onServerChange">
            <el-option-group v-for="group in formServerGroups" :key="group.label" :label="group.label">
              <el-option
                v-for="s in group.servers"
                :key="s.id"
                :label="formatServerLabel(s)"
                :value="s.id"
              />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="记录值">
          <el-input v-model="form.record_value" placeholder="IP地址或CNAME目标" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="可选备注信息" />
        </el-form-item>
        <el-form-item label="有效期" v-if="!form.id">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number v-model="form.duration_value" :min="1" :max="100" style="width:100px" />
            <el-select v-model="form.duration_unit" style="width:80px">
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <span style="color:#909399;font-size:12px">（用户首次登录后开始计算）</span>
          </div>
        </el-form-item>
        <el-form-item label="自动创建FTP" v-if="!form.id">
          <el-switch v-model="form.auto_ftp" />
        </el-form-item>
        <el-form-item label="自动配置Nginx" v-if="!form.id">
          <el-switch v-model="form.auto_nginx" />
          <el-select v-model="form.nginx_type" style="width:120px;margin-left:10px" v-if="form.auto_nginx">
            <el-option label="HTTPS" value="https" />
            <el-option label="HTTP" value="http" />
          </el-select>
        </el-form-item>
      </el-form>
    </AppDialog>

    <!-- 批量生成对话框 -->
    <el-dialog v-model="batchDialogVisible" title="批量生成子域名" width="600px" append-to-body>
      <el-form :model="batchForm" label-width="110px">
        <el-form-item label="主域名">
          <el-select v-model="batchForm.domain_id" placeholder="选择主域名" style="width:100%">
            <el-option v-for="d in activeDomains" :key="d.id" :value="d.id" :label="d.domain + (d.is_default === 1 ? ' (默认)' : '')">
              <div class="domain-option">
                <span>{{ d.domain }}{{ d.is_default === 1 ? ' (默认)' : '' }}</span>
                <span v-if="parseTags(d.tags).length" class="domain-option-tags">
                  <el-tag v-for="tag in parseTags(d.tags)" :key="tag" :style="getTagStyle(tag)" size="small">{{ tag }}</el-tag>
                </span>
              </div>
            </el-option>
          </el-select>
          <div v-if="batchDomainFilterTags.length" class="server-tag-hint">
            匹配标签：{{ batchDomainFilterTags.join('、') }}
          </div>
        </el-form-item>
        <el-form-item label="服务器">
          <el-select v-model="batchForm.server_id" placeholder="选择服务器" style="width:100%">
            <el-option-group v-for="group in batchServerGroups" :key="group.label" :label="group.label">
              <el-option
                v-for="s in group.servers"
                :key="s.id"
                :label="formatServerLabel(s)"
                :value="s.id"
              />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="生成规则">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <el-input v-model="batchForm.prefix" placeholder="前缀" style="width:80px">
              <template #prepend>前缀</template>
            </el-input>
            <span style="color:#999">+ 随机字母 +</span>
            <el-input v-model="batchForm.suffix" placeholder="后缀" style="width:80px">
              <template #prepend>后缀</template>
            </el-input>
          </div>
        </el-form-item>
        <el-form-item label="总长度">
          <el-input-number v-model="batchForm.subdomain_length" :min="3" :max="20" />
          <span style="margin-left:10px;color:#999">
            预览: {{ batchForm.prefix }}{{ 'x'.repeat(Math.max(1, batchForm.subdomain_length - batchForm.prefix.length - batchForm.suffix.length)) }}{{ batchForm.suffix }}
          </span>
        </el-form-item>
        <el-form-item label="生成数量">
          <el-input-number v-model="batchForm.count" :min="1" :max="100" :step="5" />
          <span style="margin-left:10px;color:#999">最多100个</span>
        </el-form-item>
        <el-form-item label="有效期">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number v-model="batchForm.duration_value" :min="1" :max="100" style="width:100px" />
            <el-select v-model="batchForm.duration_unit" style="width:80px">
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <span style="color:#909399;font-size:12px">（用户首次登录后开始计算）</span>
          </div>
        </el-form-item>
        <el-form-item label="自动创建FTP">
          <el-switch v-model="batchForm.auto_ftp" />
        </el-form-item>
        <el-form-item label="自动配置Nginx">
          <el-switch v-model="batchForm.auto_nginx" />
          <el-select v-model="batchForm.nginx_type" style="width:120px;margin-left:10px" v-if="batchForm.auto_nginx">
            <el-option label="HTTPS" value="https" />
            <el-option label="HTTP" value="http" />
          </el-select>
        </el-form-item>
      </el-form>
      <div v-if="batchResults.length > 0" style="margin-top:20px">
        <el-divider>生成结果</el-divider>
        <el-table :data="batchResults" size="small" stripe max-height="300">
          <el-table-column prop="subdomain" label="域名" min-width="180" />
          <el-table-column label="FTP用户" width="120">
            <template #default="{ row }">{{ row.ftp?.username || '-' }}</template>
          </el-table-column>
          <el-table-column label="授权码" width="100">
            <template #default="{ row }">
              <span style="color:#e6a23c;font-weight:bold">{{ row.ftp?.auth_code || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '成功' : '失败' }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <template #footer>
        <el-button @click="batchDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="handleBatchCreate" :loading="batchCreating">开始生成</el-button>
      </template>
    </el-dialog>

    <!-- Nginx配置对话框 -->
    <NginxDialog v-model="nginxDialogVisible" :subdomain="currentSubdomain" @refresh="loadData" />

    <!-- 修改状态对话框 -->
    <el-dialog v-model="statusDialogVisible" title="修改使用状态" width="480px" append-to-body class="status-dialog">
      <div class="status-dialog-body">
        <div class="status-info-card">
          <div class="status-domain">{{ statusForm.fullDomain }}</div>
          <div class="status-info-grid">
            <div class="status-info-item">
              <span class="status-info-label">当前状态</span>
              <el-tag :type="getUseStatusType(statusForm.use_status)" size="small">
                {{ getUseStatusText(statusForm.use_status) }}
              </el-tag>
            </div>
            <div class="status-info-item">
              <span class="status-info-label">到期时间</span>
              <template v-if="statusForm.expire_at">
                <span :class="getExpireClass(statusForm.expire_at)">
                  {{ formatDateShort(statusForm.expire_at) }}
                </span>
                <span class="status-expire-hint">
                  {{ isExpired(statusForm.expire_at) ? '已过期' : `剩余 ${getRemainingDays(statusForm.expire_at)} 天` }}
                </span>
              </template>
              <span v-else class="status-expire-empty">未设置</span>
            </div>
          </div>
        </div>

        <div class="status-picker">
          <div class="status-picker-title">选择新状态</div>
          <div class="status-options">
            <button
              v-for="option in statusOptions"
              :key="option.value"
              type="button"
              class="status-option"
              :class="[`is-${option.type}`, { active: statusForm.new_status === option.value }]"
              @click="statusForm.new_status = option.value"
            >
              <span class="status-option-label">{{ option.label }}</span>
              <span class="status-option-desc">{{ option.desc }}</span>
            </button>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="statusDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="handleStatusChange"
          :loading="statusChanging"
          :disabled="statusForm.new_status === statusForm.use_status"
        >
          保存状态
        </el-button>
      </template>
    </el-dialog>

    <!-- 续费/时长调整对话框 -->
    <el-dialog v-model="renewDialogVisible" title="续费 / 时长调整" width="500px" append-to-body>
      <el-form :model="renewForm" label-width="100px">
        <el-form-item label="域名">
          <span class="full-domain">{{ renewForm.fullDomain }}</span>
        </el-form-item>
        <el-form-item label="当前状态">
          <el-tag :type="getUseStatusType(renewForm.use_status)">{{ getUseStatusText(renewForm.use_status) }}</el-tag>
        </el-form-item>
        <el-form-item label="到期时间">
          <span v-if="renewForm.expire_at" :style="{ color: isExpired(renewForm.expire_at) ? '#f56c6c' : '#67c23a' }">
            {{ renewForm.expire_at }}
            <el-tag v-if="isExpired(renewForm.expire_at)" type="danger" size="small" style="margin-left:8px">已过期</el-tag>
          </span>
          <span v-else style="color:#999">未设置</span>
        </el-form-item>
        <el-divider>时长调整</el-divider>
        <el-form-item label="快捷续费">
          <div class="renew-quick-actions">
            <el-button
              v-for="option in renewIncreaseOptions"
              :key="`single-${option.value}`"
              size="small"
              :type="renewForm.quickDuration === option.value ? 'warning' : 'default'"
              :plain="renewForm.quickDuration !== option.value"
              :disabled="renewing"
              @click="selectQuickDuration(option.value)"
            >
              {{ option.shortLabel }}
            </el-button>
          </div>
          <div class="renew-quick-tip">点击选择快捷时长，然后点击下方确认按钮执行。</div>
        </el-form-item>
        <el-form-item label="快捷扣减">
          <div class="renew-quick-actions">
            <el-button
              v-for="option in renewDecreaseOptions"
              :key="`single-decrease-${option.value}`"
              size="small"
              :type="renewForm.quickDuration === option.value ? 'danger' : 'default'"
              :plain="renewForm.quickDuration !== option.value"
              :disabled="renewing || !renewForm.expire_at"
              @click="selectQuickDuration(option.value)"
            >
              {{ option.shortLabel }}
            </el-button>
          </div>
          <div class="renew-quick-tip">扣减会把当前到期时间往前调整，未设置到期时间时不可扣减。</div>
        </el-form-item>
        <el-form-item label="自定义时长">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number 
              v-model="renewForm.customValue" 
              :min="1" 
              :max="999" 
              style="width:120px"
              @change="onCustomValueChange"
            />
            <el-select 
              v-model="renewForm.customUnit" 
              style="width:100px"
              @change="onCustomValueChange"
            >
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <el-button 
              type="primary" 
              size="small" 
              @click="applyCustomDuration"
              :disabled="!renewForm.customValue"
            >
              应用
            </el-button>
          </div>
          <div class="renew-quick-tip">输入数值和单位，点击应用按钮。负数表示扣减。</div>
        </el-form-item>
        <el-form-item label="已选时长" v-if="renewForm.quickDuration">
          <el-tag :type="renewForm.quickDuration > 0 ? 'warning' : 'danger'" size="large">
            {{ getDurationText(renewForm.quickDuration) }}
          </el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renewDialogVisible = false">取消</el-button>
        <el-button 
          type="warning" 
          @click="confirmRenewAdjust" 
          :loading="renewing" 
          :disabled="!renewForm.quickDuration"
        >
          确认调整
        </el-button>
      </template>
    </el-dialog>

    <!-- 删除选项对话框 -->
    <el-dialog v-model="deleteDialogVisible" title="删除子域名" width="460px" append-to-body>
      <div style="margin-bottom:15px">
        <el-alert type="warning" :closable="false">
          <template #title>
            <span style="font-size:13px">
              即将删除 <strong style="color:#f56c6c">{{ deleteForm.rows.length }}</strong> 个子域名，将同时删除 <strong>DNS 解析记录</strong> 和子域名记录，此操作不可恢复。
            </span>
          </template>
        </el-alert>
      </div>
      <div style="margin-bottom:10px;color:#606266;font-size:13px">可选清理服务器上的残留资源：</div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <el-checkbox v-model="deleteForm.delete_ftp">
          删除服务器上的 FTP 账号（系统用户）
        </el-checkbox>
        <el-checkbox v-model="deleteForm.delete_files">
          <span style="color:#f56c6c">删除网站文件（rm -rf 网站目录，不可恢复）</span>
        </el-checkbox>
      </div>
      <template #footer>
        <el-button @click="deleteDialogVisible = false">取消</el-button>
        <el-button type="danger" @click="confirmDelete" :loading="deleting">确认删除</el-button>
      </template>
    </el-dialog>

    <!-- 检测直传对话框 -->
    <el-dialog v-model="checkDirectDialogVisible" title="直传可用性检测" width="460px" append-to-body>
      <div v-loading="checkingDirect">
        <div v-if="directCheckResult">
          <div style="margin-bottom:15px;font-weight:600">{{ directCheckResult.domain }}</div>
          <el-result
            :icon="directCheckResult.usable ? 'success' : 'warning'"
            :title="directCheckResult.usable ? '直传已就绪' : '直传不可用，将回退中转上传'"
          >
            <template #sub-title>
              <div style="text-align:left">
                <div style="display:flex;justify-content:space-between;padding:4px 0">
                  <span>直传脚本已部署</span>
                  <el-tag :type="directCheckResult.checks.script_exists ? 'success' : 'danger'" size="small">
                    {{ directCheckResult.checks.script_exists ? '是' : '否' }}
                  </el-tag>
                </div>
                <div style="display:flex;justify-content:space-between;padding:4px 0">
                  <span>网站已配置 SSL</span>
                  <el-tag :type="directCheckResult.checks.has_ssl ? 'success' : 'danger'" size="small">
                    {{ directCheckResult.checks.has_ssl ? '是' : '否' }}
                  </el-tag>
                </div>
                <div style="display:flex;justify-content:space-between;padding:4px 0">
                  <span>网站支持 PHP</span>
                  <el-tag :type="(directCheckResult.checks.php_enabled || directCheckResult.checks.php_installed) ? 'success' : 'danger'" size="small">
                    {{ (directCheckResult.checks.php_enabled || directCheckResult.checks.php_installed) ? '是' : '否' }}
                  </el-tag>
                </div>
              </div>
            </template>
          </el-result>
          <div v-if="directCheckResult.problems && directCheckResult.problems.length" style="margin-top:10px">
            <el-alert type="warning" :closable="false">
              <template #title>
                <div v-for="(p, i) in directCheckResult.problems" :key="i" style="font-size:12px;line-height:1.6">• {{ p }}</div>
              </template>
            </el-alert>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="checkDirectDialogVisible = false">关闭</el-button>
        <el-button v-if="directCheckResult && !directCheckResult.checks.script_exists" type="primary" @click="deployForChecked" :loading="deployingScript">补发脚本</el-button>
      </template>
    </el-dialog>

    <!-- FTP信息对话框 -->
    <el-dialog v-model="ftpInfoDialogVisible" title="FTP 账号信息" width="480px" append-to-body>
      <div v-loading="ftpInfoLoading">
        <template v-if="ftpInfo.has_ftp">
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="网站域名">{{ ftpInfo.full_domain }}</el-descriptions-item>
            <el-descriptions-item label="服务器IP">{{ ftpInfo.server_ip || '-' }}</el-descriptions-item>
            <el-descriptions-item label="FTP用户名">
              <span class="ftp-value">{{ ftpInfo.username }}</span>
              <el-button type="primary" link size="small" @click="copyFtpText(ftpInfo.username)">复制</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="FTP密码">
              <span class="ftp-value">{{ showFtpPassword ? ftpInfo.password : '••••••••' }}</span>
              <el-button type="primary" link size="small" @click="showFtpPassword = !showFtpPassword">
                {{ showFtpPassword ? '隐藏' : '显示' }}
              </el-button>
              <el-button type="primary" link size="small" @click="copyFtpText(ftpInfo.password)">复制</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="端口">{{ ftpInfo.port || 21 }}</el-descriptions-item>
            <el-descriptions-item label="目录">
              <span class="ftp-value">{{ ftpInfo.home_dir }}</span>
              <el-button type="primary" link size="small" @click="copyFtpText(ftpInfo.home_dir)">复制</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="授权码">
              <span class="ftp-value" style="color:#e6a23c;font-weight:bold">{{ ftpInfo.auth_code }}</span>
              <el-button type="primary" link size="small" @click="copyFtpText(ftpInfo.auth_code)">复制</el-button>
            </el-descriptions-item>
            <el-descriptions-item label="同步状态">
              <el-tag :type="ftpInfo.sync_status === 'synced' ? 'success' : ftpInfo.sync_status === 'error' ? 'danger' : 'warning'" size="small">
                {{ ftpInfo.sync_status === 'synced' ? '已同步' : ftpInfo.sync_status === 'error' ? '同步失败' : '待同步' }}
              </el-tag>
            </el-descriptions-item>
          </el-descriptions>
        </template>
        <el-empty v-else-if="!ftpInfoLoading" description="该子域名没有 FTP 账号" />
      </div>
      <template #footer>
        <el-button @click="ftpInfoDialogVisible = false">关闭</el-button>
        <el-button v-if="ftpInfo.has_ftp" type="primary" @click="copyAllFtpInfo">复制全部</el-button>
      </template>
    </el-dialog>

    <!-- 修改备注对话框 -->
    <el-dialog v-model="remarkDialogVisible" title="修改备注" width="400px" append-to-body>
      <el-form :model="remarkForm" label-width="80px">
        <el-form-item label="域名">
          <span class="full-domain">{{ remarkForm.fullDomain }}</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="remarkForm.remark" type="textarea" :rows="3" placeholder="请输入备注信息" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="remarkDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleRemarkSave" :loading="remarkSaving">保存</el-button>
      </template>
    </el-dialog>

    <!-- 批量时长调整对话框 -->
    <el-dialog v-model="batchRenewDialogVisible" title="批量时长调整" width="480px" append-to-body>
      <el-form label-width="100px">
        <el-form-item label="选中数量">
          <el-tag type="info">{{ selectedRows.length }} 个子域名</el-tag>
        </el-form-item>
        <el-form-item label="快捷续费">
          <div class="renew-quick-actions">
            <el-button
              v-for="option in renewIncreaseOptions"
              :key="`batch-${option.value}`"
              size="small"
              :type="batchRenewDuration === option.value ? 'primary' : 'default'"
              :plain="batchRenewDuration !== option.value"
              :disabled="batchRenewing"
              @click="selectBatchDuration(option.value)"
            >
              {{ option.shortLabel }}
            </el-button>
          </div>
          <div class="renew-quick-tip">常用时长支持一键续费，适合批量处理即将到期的域名。</div>
        </el-form-item>
        <el-form-item label="快捷扣减">
          <div class="renew-quick-actions">
            <el-button
              v-for="option in renewDecreaseOptions"
              :key="`batch-decrease-${option.value}`"
              size="small"
              :type="batchRenewDuration === option.value ? 'danger' : 'default'"
              :plain="batchRenewDuration !== option.value"
              :disabled="batchRenewing"
              @click="selectBatchDuration(option.value)"
            >
              {{ option.shortLabel }}
            </el-button>
          </div>
          <div class="renew-quick-tip">批量扣减时，未设置到期时间的子域名会自动计为失败。</div>
        </el-form-item>
        <el-form-item label="自定义时长">
          <div style="display:flex;gap:10px;align-items:center">
            <el-input-number 
              v-model="batchCustomValue" 
              :min="1" 
              :max="999" 
              style="width:120px"
              @change="onBatchCustomChange"
            />
            <el-select 
              v-model="batchCustomUnit" 
              style="width:100px"
              @change="onBatchCustomChange"
            >
              <el-option label="天" value="day" />
              <el-option label="月" value="month" />
              <el-option label="年" value="year" />
            </el-select>
            <el-button 
              type="primary" 
              size="small" 
              @click="applyBatchCustomDuration"
              :disabled="!batchCustomValue"
            >
              应用
            </el-button>
          </div>
          <div class="renew-quick-tip">输入数值和单位，点击应用按钮。负数表示扣减。</div>
        </el-form-item>
        <el-form-item label="已选时长" v-if="batchRenewDuration">
          <el-tag :type="batchRenewDuration > 0 ? 'primary' : 'danger'" size="large">
            {{ getDurationText(batchRenewDuration) }}
          </el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchRenewDialogVisible = false">取消</el-button>
        <el-button 
          type="primary" 
          @click="confirmBatchAdjustDuration" 
          :loading="batchRenewing" 
          :disabled="!batchRenewDuration"
        >
          确认调整
        </el-button>
      </template>
    </el-dialog>

    <!-- 限流配置对话框 -->
    <el-dialog v-model="rateLimitDialogVisible" title="限流配置" width="550px" append-to-body>
      <el-alert type="info" :closable="false" style="margin-bottom:20px">
        <template #title>
          <div style="font-size:13px;line-height:1.6">
            限流功能可以防止恶意请求和 DDoS 攻击，保护服务器资源。配置后会自动更新 Nginx 配置并重载。
          </div>
        </template>
      </el-alert>
      <el-form :model="rateLimitForm" label-width="120px">
        <el-form-item label="域名">
          <span class="full-domain">{{ rateLimitForm.fullDomain }}</span>
        </el-form-item>
        <el-form-item label="启用限流">
          <el-switch v-model="rateLimitForm.enabled" />
          <span style="margin-left:10px;color:#909399;font-size:12px">
            {{ rateLimitForm.enabled ? '已启用' : '已禁用' }}
          </span>
        </el-form-item>
        <template v-if="rateLimitForm.enabled">
          <el-form-item label="请求速率">
            <el-input v-model="rateLimitForm.rate" placeholder="例如: 10r/s" style="width:150px">
              <template #append>请求/秒</template>
            </el-input>
            <div style="margin-top:5px;color:#909399;font-size:12px">
              格式: 数字 + r/s (每秒) 或 r/m (每分钟)，例如: 10r/s 或 100r/m
            </div>
          </el-form-item>
          <el-form-item label="突发请求数">
            <el-input-number v-model="rateLimitForm.burst" :min="1" :max="1000" style="width:150px" />
            <div style="margin-top:5px;color:#909399;font-size:12px">
              允许的突发请求数量，超过速率限制时的缓冲区大小
            </div>
          </el-form-item>
          <el-form-item label="无延迟处理">
            <el-switch v-model="rateLimitForm.nodelay" />
            <span style="margin-left:10px;color:#909399;font-size:12px">
              {{ rateLimitForm.nodelay ? '立即处理突发请求' : '延迟处理突发请求' }}
            </span>
          </el-form-item>
          <el-form-item label="并发连接数">
            <el-input-number v-model="rateLimitForm.conn_limit" :min="1" :max="1000" style="width:150px" />
            <div style="margin-top:5px;color:#909399;font-size:12px">
              单个 IP 允许的最大并发连接数
            </div>
          </el-form-item>
        </template>
        <el-form-item label="推荐配置">
          <div style="display:flex;flex-direction:column;gap:8px">
            <el-button size="small" @click="applyRateLimitPreset('low')">低限制 (100r/s, 200突发)</el-button>
            <el-button size="small" @click="applyRateLimitPreset('medium')">中限制 (50r/s, 100突发)</el-button>
            <el-button size="small" @click="applyRateLimitPreset('high')">高限制 (10r/s, 20突发)</el-button>
            <el-button size="small" @click="applyRateLimitPreset('strict')">严格限制 (5r/s, 10突发)</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rateLimitDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleRateLimitSave" :loading="rateLimitSaving">保存并应用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, Refresh, Search } from '@element-plus/icons-vue'
import { useDataStore } from '@/stores/data'
import api from '@/api'
import NginxDialog from '@/components/NginxDialog.vue'
import {
  parseTagList as parseTags,
  getDomainFilterableTags,
  groupServersByDomainTags,
  pickDefaultServerForDomain,
  getTagStyle as buildTagStyle
} from '@/utils/server-tag-filter'

const route = useRoute()
const dataStore = useDataStore()

const filterDomainId = ref(null)
const dialogVisible = ref(false)
const batchDialogVisible = ref(false)
const nginxDialogVisible = ref(false)
const statusDialogVisible = ref(false)
const renewDialogVisible = ref(false)
const saving = ref(false)
const loading = ref(false)
const refreshing = ref(false)
const batchCreating = ref(false)
const statusChanging = ref(false)
const renewing = ref(false)
const currentSubdomain = ref(null)
const batchResults = ref([])
const searchKeyword = ref('')
const searchTimer = ref(null)
const filterServerId = ref(null)
const filterStatus = ref('')
const filterExpiringSoon = ref(false)
const filterExpired = ref(false)

// 删除选项对话框
const deleteDialogVisible = ref(false)
const deleting = ref(false)
const deployingScript = ref(false)
// 检测直传
const checkDirectDialogVisible = ref(false)
const checkingDirect = ref(false)
const directCheckResult = ref(null)
const directCheckRow = ref(null)
const deleteForm = reactive({
  rows: [],
  delete_ftp: false,
  delete_files: false
})
const currentPage = ref(1)
const pageSize = ref(10)
const selectedRows = ref([])
const renewIncreaseOptions = [
  { label: '1个月', shortLabel: '+1个月', value: 1 },
  { label: '3个月', shortLabel: '+3个月', value: 3 },
  { label: '6个月', shortLabel: '+6个月', value: 6 },
  { label: '1年', shortLabel: '+1年', value: 12 },
  { label: '2年', shortLabel: '+2年', value: 24 },
  { label: '3年', shortLabel: '+3年', value: 36 }
]
const renewDecreaseOptions = [
  { label: '扣减1个月', shortLabel: '-1个月', value: -1 },
  { label: '扣减3个月', shortLabel: '-3个月', value: -3 },
  { label: '扣减6个月', shortLabel: '-6个月', value: -6 }
]
const renewDurationOptions = [...renewIncreaseOptions, ...renewDecreaseOptions]

const statusForm = reactive({
  id: null,
  fullDomain: '',
  use_status: 'unused',
  expire_at: '',
  new_status: 'unused'
})

const statusOptions = [
  { value: 'unused', label: '未使用', desc: '尚未分配或空闲', type: 'info' },
  { value: 'used', label: '已使用', desc: '正在对外提供服务', type: 'success' },
  { value: 'disabled', label: '已停用', desc: '停用后无法访问', type: 'danger' }
]

const renewForm = reactive({
  id: null,
  fullDomain: '',
  use_status: 'unused',
  expire_at: '',
  quickDuration: null,
  customValue: 1,
  customUnit: 'month'
})

// 获取上传页面URL
function getUploadUrl(row) {
  if (row.ftp_auth_code) {
    return `${window.location.origin}?code=${row.ftp_auth_code}`
  }
  return null
}

// 使用状态相关
function getUseStatusType(status) {
  const types = { unused: 'info', used: 'success', disabled: 'danger' }
  return types[status] || 'info'
}

function getUseStatusText(status) {
  const texts = { unused: '未使用', used: '已使用', disabled: '已停用' }
  return texts[status] || '未使用'
}

function getDnsStatusText(status) {
  const texts = { active: '正常', dns_error: '异常', pending: '待同步' }
  return texts[status] || status || '未知'
}

function isExpired(expireAt) {
  if (!expireAt) return false
  return new Date(expireAt) < new Date()
}

function getRemainingDays(expireAt) {
  if (!expireAt) return 0
  const now = new Date()
  const expire = new Date(expireAt)
  const diff = expire - now
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

function getExpireClass(expireAt) {
  if (isExpired(expireAt)) return 'expire-danger'
  if (getRemainingDays(expireAt) <= 7) return 'expire-warning'
  return 'expire-success'
}

function formatDateShort(value) {
  if (!value) return '-'
  return String(value).slice(0, 10)
}

// 计算有效期天数
function calcDurationDays(value, unit) {
  const v = parseInt(value) || 1
  if (unit === 'day') return v
  if (unit === 'month') return v * 31
  if (unit === 'year') return v * 365
  return v
}

// 打开修改状态对话框
function openStatusDialog(row) {
  statusForm.id = row.id
  statusForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  statusForm.use_status = row.use_status || 'unused'
  statusForm.expire_at = row.expire_at || ''
  statusForm.new_status = row.use_status || 'unused'
  statusDialogVisible.value = true
}

// 保存状态修改
async function handleStatusChange() {
  statusChanging.value = true
  try {
    await api.put(`/dns/subdomains/${statusForm.id}/status`, { use_status: statusForm.new_status })
    ElMessage.success('状态已更新')
    statusDialogVisible.value = false
    loadData()
  } finally {
    statusChanging.value = false
  }
}

// 打开续费对话框
function openRenewDialog(row) {
  renewForm.id = row.id
  renewForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  renewForm.use_status = row.use_status || 'unused'
  renewForm.expire_at = row.expire_at || ''
  renewForm.quickDuration = null
  renewForm.customValue = 1
  renewForm.customUnit = 'month'
  renewDialogVisible.value = true
}

// 选择快捷时长
function selectQuickDuration(months) {
  renewForm.quickDuration = months
}

// 自定义时长改变时
function onCustomValueChange() {
  // 清除快捷选择
  renewForm.quickDuration = null
}

// 应用自定义时长
function applyCustomDuration() {
  const value = renewForm.customValue
  const unit = renewForm.customUnit
  
  let months = 0
  if (unit === 'day') {
    months = value / 30 // 按30天算一个月
  } else if (unit === 'month') {
    months = value
  } else if (unit === 'year') {
    months = value * 12
  }
  
  renewForm.quickDuration = Math.round(months)
}

// 获取时长文本
function getDurationText(months) {
  const absMonths = Math.abs(months)
  const prefix = months > 0 ? '增加 ' : '扣减 '
  
  if (absMonths >= 12 && absMonths % 12 === 0) {
    return prefix + (absMonths / 12) + ' 年'
  } else if (absMonths >= 1) {
    return prefix + absMonths + ' 个月'
  } else {
    return prefix + Math.round(absMonths * 30) + ' 天'
  }
}

function getDurationActionText(duration) {
  return Number(duration) > 0 ? '续费' : '扣减'
}

// 确认续费调整（带二次确认）
async function confirmRenewAdjust() {
  const targetDuration = renewForm.quickDuration
  if (!targetDuration) return
  
  if (targetDuration < 0 && !renewForm.expire_at) {
    ElMessage.warning('当前未设置到期时间，无法扣减时长')
    return
  }

  try {
    const actionText = getDurationActionText(targetDuration)
    const durationText = getDurationText(targetDuration)
    
    await ElMessageBox.confirm(
      `确定要对 "${renewForm.fullDomain}" 执行${actionText}操作吗？\n\n调整时长：${durationText}`,
      `确认${actionText}`,
      {
        type: targetDuration > 0 ? 'warning' : 'error',
        confirmButtonText: '确认',
        cancelButtonText: '取消'
      }
    )
    
    await handleRenewAdjust(targetDuration)
  } catch (err) {
    // 用户取消
  }
}

// 续费/时长调整
async function handleRenewAdjust(duration) {
  const targetDuration = Number(duration || renewForm.quickDuration)
  if (!targetDuration) return

  renewing.value = true
  try {
    const res = await api.post(`/dns/subdomains/${renewForm.id}/renew`, { duration_months: targetDuration })
    ElMessage.success(`${getDurationActionText(targetDuration)}成功，到期时间: ${res.expire_at}`)
    renewForm.expire_at = res.expire_at
    renewForm.quickDuration = null
    renewDialogVisible.value = false
    loadData()
  } finally {
    renewing.value = false
  }
}

async function handleDisable(row) {
  await ElMessageBox.confirm('停用将删除DNS解析记录，确定？', '提示')
  await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'disabled' })
  ElMessage.success('已停用')
  loadData()
}

async function handleEnable(row) {
  // 启用时恢复为"已使用"状态
  await api.put(`/dns/subdomains/${row.id}/status`, { use_status: 'used' })
  ElMessage.success('已启用')
  loadData()
}

// 批量操作
function onSelectionChange(rows) {
  selectedRows.value = rows
}

const batchRenewDialogVisible = ref(false)
const batchRenewDuration = ref(null)
const batchRenewing = ref(false)
const batchCustomValue = ref(1)
const batchCustomUnit = ref('month')

// 备注相关
const remarkDialogVisible = ref(false)
const remarkSaving = ref(false)
const remarkForm = reactive({
  id: null,
  fullDomain: '',
  remark: ''
})

// FTP信息相关
const ftpInfoDialogVisible = ref(false)
const ftpInfoLoading = ref(false)
const showFtpPassword = ref(false)
const ftpInfo = reactive({
  has_ftp: false,
  full_domain: '',
  server_ip: '',
  username: '',
  password: '',
  port: 21,
  home_dir: '',
  auth_code: '',
  sync_status: ''
})

// 限流配置相关
const rateLimitDialogVisible = ref(false)
const rateLimitSaving = ref(false)
const rateLimitForm = reactive({
  id: null,
  fullDomain: '',
  enabled: false,
  rate: '10r/s',
  burst: 20,
  nodelay: true,
  conn_limit: 10
})

function openRemarkDialog(row) {
  remarkForm.id = row.id
  remarkForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  remarkForm.remark = row.remark || ''
  remarkDialogVisible.value = true
}

async function openFtpInfoDialog(row) {
  ftpInfoDialogVisible.value = true
  ftpInfoLoading.value = true
  showFtpPassword.value = false
  ftpInfo.has_ftp = false
  try {
    const res = await api.get(`/dns/subdomains/${row.id}/ftp-info`)
    Object.assign(ftpInfo, res)
  } catch (e) {
    ElMessage.error(e.message || '获取FTP信息失败')
  } finally {
    ftpInfoLoading.value = false
  }
}

function copyFtpText(text) {
  if (!text) return
  navigator.clipboard.writeText(String(text)).then(() => {
    ElMessage.success('已复制')
  }).catch(() => {
    const textarea = document.createElement('textarea')
    textarea.value = String(text)
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('已复制')
  })
}

function copyAllFtpInfo() {
  const text = `网站域名：${ftpInfo.full_domain}\n服务器IP：${ftpInfo.server_ip || '-'}\nFTP用户名：${ftpInfo.username}\nFTP密码：${ftpInfo.password}\n端口：${ftpInfo.port || 21}\n目录：${ftpInfo.home_dir}\n授权码：${ftpInfo.auth_code}`
  copyFtpText(text)
}

async function handleRemarkSave() {
  remarkSaving.value = true
  try {
    await api.put(`/dns/subdomains/${remarkForm.id}/remark`, { remark: remarkForm.remark })
    ElMessage.success('备注已更新')
    remarkDialogVisible.value = false
    loadData()
  } finally {
    remarkSaving.value = false
  }
}

async function batchSetStatus(status) {
  if (selectedRows.value.length === 0) return
  const statusText = { used: '已使用', unused: '未使用', disabled: '停用' }
  await ElMessageBox.confirm(`确定将 ${selectedRows.value.length} 个子域名设为${statusText[status]}？`, '批量操作')
  
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await api.put(`/dns/subdomains/${row.id}/status`, { use_status: status })
      success++
    } catch (e) {
      failed++
    }
  }
  ElMessage.success(`操作完成: 成功${success}个, 失败${failed}个`)
  selectedRows.value = []
  loadData()
}

function openBatchRenewDialog() {
  if (selectedRows.value.length === 0) return
  batchRenewDuration.value = null
  batchCustomValue.value = 1
  batchCustomUnit.value = 'month'
  batchRenewDialogVisible.value = true
}

// 选择批量时长
function selectBatchDuration(months) {
  batchRenewDuration.value = months
}

// 批量自定义时长改变
function onBatchCustomChange() {
  batchRenewDuration.value = null
}

// 应用批量自定义时长
function applyBatchCustomDuration() {
  const value = batchCustomValue.value
  const unit = batchCustomUnit.value
  
  let months = 0
  if (unit === 'day') {
    months = value / 30
  } else if (unit === 'month') {
    months = value
  } else if (unit === 'year') {
    months = value * 12
  }
  
  batchRenewDuration.value = Math.round(months)
}

// 确认批量调整（带二次确认）
async function confirmBatchAdjustDuration() {
  const targetDuration = batchRenewDuration.value
  if (!targetDuration || selectedRows.value.length === 0) return

  try {
    const actionText = getDurationActionText(targetDuration)
    const durationText = getDurationText(targetDuration)
    
    await ElMessageBox.confirm(
      `确定要对选中的 ${selectedRows.value.length} 个子域名执行${actionText}操作吗？\n\n调整时长：${durationText}`,
      `批量${actionText}`,
      {
        type: targetDuration > 0 ? 'warning' : 'error',
        confirmButtonText: '确认',
        cancelButtonText: '取消'
      }
    )
    
    await handleBatchAdjustDuration(targetDuration)
  } catch (err) {
    // 用户取消
  }
}

async function handleBatchAdjustDuration(duration) {
  const targetDuration = Number(duration || batchRenewDuration.value)
  if (!targetDuration || selectedRows.value.length === 0) return

  batchRenewing.value = true
  try {
    let success = 0, failed = 0
    for (const row of selectedRows.value) {
      try {
        await api.post(`/dns/subdomains/${row.id}/renew`, { duration_months: targetDuration })
        success++
      } catch (e) {
        failed++
      }
    }
    ElMessage.success(`${getDurationActionText(targetDuration)}完成: 成功${success}个, 失败${failed}个`)
    batchRenewDialogVisible.value = false
    selectedRows.value = []
    loadData()
  } finally {
    batchRenewing.value = false
  }
}

function batchDelete() {
  if (selectedRows.value.length === 0) return
  openDeleteDialog(selectedRows.value)
}

// 批量补发 PHP 直传脚本（选中的则只补选中的，否则全部）
async function batchDeployUploadScript() {
  const ids = selectedRows.value.map(r => r.id)
  const scope = ids.length > 0 ? `选中的 ${ids.length} 个` : '所有'
  try {
    await ElMessageBox.confirm(`确定给${scope}子域名补发直传脚本（_vhost/upload.php）？`, '补发直传脚本')
  } catch (e) {
    return
  }
  deployingScript.value = true
  try {
    const res = await api.post('/dns/subdomains/batch-deploy-upload-script', { ids })
    ElMessage.success(`补发完成: 成功 ${res.success} 个, 失败 ${res.failed} 个`)
  } catch (e) {
    ElMessage.error(e.message || '补发失败')
  } finally {
    deployingScript.value = false
  }
}

// 检测单个子域名的直传可用性
async function checkDirectUpload(row) {
  directCheckRow.value = row
  directCheckResult.value = null
  checkDirectDialogVisible.value = true
  checkingDirect.value = true
  try {
    const res = await api.get(`/dns/subdomains/${row.id}/check-direct-upload`)
    directCheckResult.value = res
  } catch (e) {
    ElMessage.error(e.message || '检测失败')
    checkDirectDialogVisible.value = false
  } finally {
    checkingDirect.value = false
  }
}

// 检测结果里直接补发脚本并重新检测
async function deployForChecked() {
  if (!directCheckRow.value) return
  deployingScript.value = true
  try {
    await api.post(`/dns/subdomains/${directCheckRow.value.id}/deploy-upload-script`)
    ElMessage.success('补发成功，重新检测中...')
    await checkDirectUpload(directCheckRow.value)
  } catch (e) {
    ElMessage.error(e.message || '补发失败')
  } finally {
    deployingScript.value = false
  }
}

// 打开删除选项对话框（单个/批量共用）
function openDeleteDialog(rows) {
  deleteForm.rows = rows
  deleteForm.delete_ftp = false
  deleteForm.delete_files = false
  deleteDialogVisible.value = true
}

// 执行删除
async function confirmDelete() {
  const rows = deleteForm.rows
  if (!rows || rows.length === 0) return

  deleting.value = true
  try {
    if (rows.length === 1) {
      await api.delete(`/dns/subdomains/${rows[0].id}`, {
        data: { delete_ftp: deleteForm.delete_ftp, delete_files: deleteForm.delete_files }
      })
      ElMessage.success('删除成功')
    } else {
      const res = await api.post('/dns/subdomains/batch-delete', {
        ids: rows.map(r => r.id),
        delete_ftp: deleteForm.delete_ftp,
        delete_files: deleteForm.delete_files
      })
      ElMessage.success(`删除完成: 成功 ${res.success} 个, 失败 ${res.failed} 个`)
    }
    deleteDialogVisible.value = false
    selectedRows.value = []
    loadData()
  } catch (e) {
    ElMessage.error(e.message || '删除失败')
  } finally {
    deleting.value = false
  }
}

const form = reactive({
  id: null, domain_id: '', subdomain: '', server_id: null,
  record_type: 'A', record_value: '', ttl: 600, remark: '',
  auto_ftp: true, auto_nginx: true, nginx_type: 'https',
  prefix: 'ly', suffix: '', subdomain_length: 8,
  duration_value: 1, duration_unit: 'month'
})

const batchForm = reactive({
  domain_id: '', server_id: '', count: 10,
  auto_ftp: true, auto_nginx: true, nginx_type: 'https',
  prefix: 'ly', suffix: '', subdomain_length: 8,
  duration_value: 1, duration_unit: 'month'
})

const currentDomain = computed(() => {
  if (!filterDomainId.value) return null
  return dataStore.domains.find(d => d.id === filterDomainId.value)
})

const availableServers = computed(() => dataStore.servers.filter(s => s.status !== 'disabled'))
const activeDomains = computed(() => dataStore.domains.filter(d => d.status !== 'disabled'))

const selectedFormDomain = computed(() => dataStore.domains.find(d => d.id === form.domain_id))
const selectedBatchDomain = computed(() => dataStore.domains.find(d => d.id === batchForm.domain_id))
const formDomainFilterTags = computed(() => getDomainFilterableTags(selectedFormDomain.value, dataStore.serverTags))
const batchDomainFilterTags = computed(() => getDomainFilterableTags(selectedBatchDomain.value, dataStore.serverTags))
const formServerGroups = computed(() => groupServersByDomainTags(dataStore.servers, selectedFormDomain.value, dataStore.serverTags))
const batchServerGroups = computed(() => groupServersByDomainTags(dataStore.servers, selectedBatchDomain.value, dataStore.serverTags))

function getTagStyle(tagName) {
  return buildTagStyle(tagName, dataStore.serverTags)
}

function formatServerLabel(server) {
  const tags = parseTags(server.tags)
  const tagText = tags.length ? ` · ${tags.join('/')}` : ''
  const defaultText = server.is_default === 1 ? ' (默认)' : ''
  return `${server.name} (${server.ip})${tagText}${defaultText}`
}

function applyDefaultServerToForm() {
  const defaultServer = pickDefaultServerForDomain(dataStore.servers, selectedFormDomain.value, dataStore.serverTags)
  if (defaultServer) {
    form.server_id = defaultServer.id
    form.record_value = defaultServer.ip
    return
  }
  form.server_id = null
  form.record_value = ''
}

function applyDefaultServerToBatchForm() {
  const defaultServer = pickDefaultServerForDomain(dataStore.servers, selectedBatchDomain.value, dataStore.serverTags)
  batchForm.server_id = defaultServer?.id || ''
}

function getDefaultAvailableServer(domain = null) {
  return pickDefaultServerForDomain(dataStore.servers, domain, dataStore.serverTags)
}

onMounted(async () => {
  await Promise.all([
    dataStore.loadDomains(),
    dataStore.loadServers(),
    dataStore.loadServerTags()
  ])
  if (route.query.domain_id) {
    filterDomainId.value = parseInt(route.query.domain_id)
  }
  loadData()
})

watch(() => form.domain_id, (domainId, oldDomainId) => {
  if (form.id || !domainId || domainId === oldDomainId) return
  applyDefaultServerToForm()
})

watch(() => batchForm.domain_id, (domainId, oldDomainId) => {
  if (!domainId || domainId === oldDomainId) return
  applyDefaultServerToBatchForm()
})

watch(searchKeyword, () => {
  if (searchTimer.value) clearTimeout(searchTimer.value)
  searchTimer.value = setTimeout(() => {
    onFilterChange()
  }, 300)
})

async function loadData() {
  loading.value = true
  try {
    await dataStore.loadSubdomains(filterDomainId.value, currentPage.value, pageSize.value, {
      server_id: filterServerId.value,
      use_status: filterStatus.value,
      expiring_soon: filterExpiringSoon.value,
      expired: filterExpired.value,
      keyword: searchKeyword.value.trim()
    })
  } finally {
    loading.value = false
  }
}

function onFilterChange() {
  currentPage.value = 1
  loadData()
}

function onPageChange(page) {
  currentPage.value = page
  loadData()
}

function onSizeChange(size) {
  pageSize.value = size
  currentPage.value = 1
  loadData()
}

async function openDialog(row = null) {
  if (row) {
    Object.assign(form, {
      id: row.id, domain_id: row.domain_id, subdomain: row.subdomain,
      server_id: row.server_id, record_type: row.record_type,
      record_value: row.record_value, ttl: row.ttl || 600, remark: row.remark || ''
    })
  } else {
    const defaultDomain = activeDomains.value.find(d => d.is_default === 1)
    const domainId = filterDomainId.value || defaultDomain?.id || ''
    const domain = dataStore.domains.find(d => d.id === domainId)
    const defaultServer = getDefaultAvailableServer(domain)
    
    Object.assign(form, {
      id: null, domain_id: domainId, subdomain: '',
      server_id: defaultServer?.id || null, record_type: 'A', record_value: defaultServer?.ip || '', ttl: 600, remark: '',
      auto_ftp: true, auto_nginx: true, nginx_type: 'https',
      prefix: 'ly', suffix: '', subdomain_length: 8,
      duration_value: 1, duration_unit: 'month'
    })
    await refreshSubdomain()
  }
  dialogVisible.value = true
}

function openBatchDialog() {
  const defaultDomain = activeDomains.value.find(d => d.is_default === 1)
  const domainId = filterDomainId.value || defaultDomain?.id || ''
  const domain = dataStore.domains.find(d => d.id === domainId)
  const defaultServer = getDefaultAvailableServer(domain)
  
  batchForm.domain_id = domainId
  batchForm.server_id = defaultServer?.id || ''
  batchForm.count = 10
  batchForm.auto_ftp = true
  batchForm.auto_nginx = true
  batchForm.nginx_type = 'https'
  batchForm.prefix = 'ly'
  batchForm.suffix = ''
  batchForm.subdomain_length = 8
  batchForm.duration_value = 1
  batchForm.duration_unit = 'month'
  batchResults.value = []
  batchDialogVisible.value = true
}

function openNginxDialog(row) {
  currentSubdomain.value = row
  nginxDialogVisible.value = true
}

async function refreshSubdomain() {
  refreshing.value = true
  try {
    const res = await api.get('/dns/generate-subdomain', {
      params: {
        prefix: form.prefix,
        suffix: form.suffix,
        length: form.subdomain_length
      }
    })
    form.subdomain = res.subdomain
  } finally {
    refreshing.value = false
  }
}

function onServerChange() {
  const server = dataStore.servers.find(s => s.id === form.server_id)
  if (server) form.record_value = server.ip
}

async function handleSave() {
  saving.value = true
  try {
    const data = { ...form, duration_days: calcDurationDays(form.duration_value, form.duration_unit) }
    if (form.id) {
      await api.put(`/dns/subdomains/${form.id}`, data)
      ElMessage.success('保存成功')
    } else {
      await api.post('/dns/subdomains', data)
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    loadData()
  } finally {
    saving.value = false
  }
}

function handleDelete(row) {
  openDeleteDialog([row])
}

async function handleBatchCreate() {
  batchCreating.value = true
  batchResults.value = []
  try {
    const data = { ...batchForm, duration_days: calcDurationDays(batchForm.duration_value, batchForm.duration_unit) }
    const res = await api.post('/dns/batch-create', data)
    batchResults.value = res.results
    ElMessage.success(`生成完成: 成功${res.success}个, 失败${res.failed}个`)
    loadData()
  } finally {
    batchCreating.value = false
  }
}

// 分享功能
function handleShare(row) {
  const uploadUrl = `${window.location.origin}?code=${row.ftp_auth_code}`
  const shareText = `上传地址：${uploadUrl}\n授权码：${row.ftp_auth_code}`
  
  navigator.clipboard.writeText(shareText).then(() => {
    ElMessage.success('分享信息已复制到剪贴板')
  }).catch(() => {
    // 降级方案
    const textarea = document.createElement('textarea')
    textarea.value = shareText
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    ElMessage.success('分享信息已复制到剪贴板')
  })
}

// 限流配置功能
function openRateLimitDialog(row) {
  rateLimitForm.id = row.id
  rateLimitForm.fullDomain = `${row.subdomain}.${row.main_domain}`
  rateLimitForm.enabled = row.rate_limit_enabled === 1
  rateLimitForm.rate = row.rate_limit_rate || '10r/s'
  rateLimitForm.burst = row.rate_limit_burst || 20
  rateLimitForm.nodelay = row.rate_limit_nodelay !== 0
  rateLimitForm.conn_limit = row.rate_limit_conn || 10
  rateLimitDialogVisible.value = true
}

function applyRateLimitPreset(preset) {
  rateLimitForm.enabled = true
  rateLimitForm.nodelay = true
  
  switch (preset) {
    case 'low':
      rateLimitForm.rate = '100r/s'
      rateLimitForm.burst = 200
      rateLimitForm.conn_limit = 50
      break
    case 'medium':
      rateLimitForm.rate = '50r/s'
      rateLimitForm.burst = 100
      rateLimitForm.conn_limit = 30
      break
    case 'high':
      rateLimitForm.rate = '10r/s'
      rateLimitForm.burst = 20
      rateLimitForm.conn_limit = 10
      break
    case 'strict':
      rateLimitForm.rate = '5r/s'
      rateLimitForm.burst = 10
      rateLimitForm.conn_limit = 5
      break
  }
}

async function handleRateLimitSave() {
  rateLimitSaving.value = true
  try {
    const res = await api.put(`/dns/subdomains/${rateLimitForm.id}/rate-limit`, {
      enabled: rateLimitForm.enabled,
      rate: rateLimitForm.rate,
      burst: rateLimitForm.burst,
      nodelay: rateLimitForm.nodelay,
      conn_limit: rateLimitForm.conn_limit
    })
    
    if (res.synced) {
      ElMessage.success('限流配置已保存并同步到服务器')
    } else if (res.error) {
      ElMessage.warning(`限流配置已保存，但同步失败: ${res.error}`)
    } else {
      ElMessage.success('限流配置已保存')
    }
    
    rateLimitDialogVisible.value = false
    loadData()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || '保存失败')
  } finally {
    rateLimitSaving.value = false
  }
}
</script>

<style scoped>
.card {
  background: rgba(255, 255, 255, 0.95);
  padding: 25px;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
}

.card-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #303133;
}

.page-header {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.header-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 14px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 10px;
}

.domain-filter-tag {
  font-weight: 400;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 12px 14px;
  background: #f8f9fb;
  border: 1px solid #eef0f4;
  border-radius: 10px;
}

.filter-search {
  width: 240px;
  flex-shrink: 0;
}

.filter-select {
  width: 150px;
  flex-shrink: 0;
}

.filter-select-wide {
  width: 190px;
}

.filter-select-narrow {
  width: 120px;
}

.filter-checks {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
}

.filter-checks :deep(.el-checkbox) {
  margin-right: 0;
  height: 24px;
  padding: 0 10px;
  background: #fff;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.domain-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.domain-option-tags {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.server-tag-hint {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.renew-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.renew-quick-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}

.full-domain {
  color: #409eff;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: color 0.3s;
  line-height: 1.2;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  max-width: 100%;
}

.full-domain.is-static {
  cursor: default;
  color: #303133;
}

.full-domain:hover {
  color: #66b1ff;
  text-decoration: underline;
}

.full-domain.is-static:hover {
  color: #303133;
  text-decoration: none;
}

.remark-text {
  font-size: 12px;
  color: #666;
  display: block;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.remark-text:hover {
  color: #409eff;
}

.domain-cell {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.domain-primary {
  min-width: 0;
}

.domain-secondary {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: wrap;
  line-height: 1.2;
}

.meta-text {
  color: #606266;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
  flex: 0 1 auto;
}

.meta-divider {
  color: #dcdfe6;
  font-size: 12px;
  flex-shrink: 0;
}

.server-text {
  color: #909399;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
  min-width: 0;
}

.server-text.is-unbound {
  color: #c0c4cc;
  font-style: italic;
}

.status-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.expire-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 1.3;
  white-space: nowrap;
}

.expire-success,
.expire-warning,
.expire-danger {
  font-size: 12px;
  font-weight: 600;
}

.expire-success {
  color: #67c23a;
}

.expire-warning {
  color: #e6a23c;
}

.expire-danger {
  color: #f56c6c;
}

.expire-date {
  color: #909399;
  font-size: 11px;
}

.row-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
}

.row-actions .el-button {
  margin-left: 0;
}

.more-actions {
  margin-top: 0;
}

.status-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.status-info-card {
  padding: 14px 16px;
  background: linear-gradient(135deg, #f8faff 0%, #f4f7fb 100%);
  border: 1px solid #e8edf5;
  border-radius: 10px;
}

.status-domain {
  font-size: 15px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 12px;
  word-break: break-all;
}

.status-info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.status-info-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.status-info-label {
  font-size: 12px;
  color: #909399;
}

.status-expire-hint {
  font-size: 12px;
  color: #909399;
}

.status-expire-empty {
  font-size: 13px;
  color: #c0c4cc;
}

.status-picker-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 10px;
}

.status-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.status-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 12px 10px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.status-option:hover {
  border-color: #c6e2ff;
  background: #f5faff;
}

.status-option.active {
  border-color: #409eff;
  background: #ecf5ff;
  box-shadow: 0 0 0 1px rgba(64, 158, 255, 0.15);
}

.status-option.is-success.active {
  border-color: #67c23a;
  background: #f0f9eb;
  box-shadow: 0 0 0 1px rgba(103, 194, 58, 0.15);
}

.status-option.is-danger.active {
  border-color: #f56c6c;
  background: #fef0f0;
  box-shadow: 0 0 0 1px rgba(245, 108, 108, 0.15);
}

.status-option-label {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.status-option-desc {
  font-size: 11px;
  color: #909399;
  line-height: 1.4;
}

.ftp-value {
  font-family: monospace;
  margin-right: 8px;
  word-break: break-all;
}

:deep(.subdomain-table) {
  border-radius: 10px;
  overflow: hidden;
}

:deep(.subdomain-table th) {
  background: #f8f9fa !important;
  font-weight: 600;
}

:deep(.subdomain-table .el-table__cell) {
  padding: 4px 0;
}

:deep(.subdomain-table .cell) {
  line-height: 1.2;
}

:deep(.el-dialog) {
  border-radius: 16px;
}

:deep(.el-dialog__header) {
  border-bottom: 1px solid #f0f0f0;
  padding: 20px 25px;
}

:deep(.el-dialog__body) {
  padding: 25px;
}

:deep(.el-dialog__footer) {
  border-top: 1px solid #f0f0f0;
  padding: 15px 25px;
}
/* ========== 移动端适配 ========== */
@media (max-width: 768px) {
  .card {
    padding: 15px;
    border-radius: 12px;
  }

  .page-header {
    margin-bottom: 12px;
    padding-bottom: 12px;
  }

  .header-top {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 10px;
  }

  .page-title {
    font-size: 16px;
  }

  .header-actions {
    justify-content: stretch;
  }

  .header-actions .el-button {
    flex: 1;
    min-width: 0;
  }

  .header-actions .el-dropdown {
    width: 100%;
  }

  .header-actions .el-dropdown .el-button {
    width: 100%;
  }

  .filter-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    padding: 10px;
  }

  .filter-search,
  .filter-select,
  .filter-select-wide,
  .filter-select-narrow {
    width: 100% !important;
  }

  .filter-checks {
    margin-left: 0;
    width: 100%;
  }

  .filter-checks :deep(.el-checkbox) {
    flex: 1;
    justify-content: center;
  }

  .status-info-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .status-options {
    grid-template-columns: 1fr;
  }

  .card-title {
    font-size: 16px;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .toolbar .el-input {
    width: 100% !important;
  }

  .toolbar .el-select {
    width: 100% !important;
  }

  .toolbar .el-button {
    width: 100%;
  }

  .toolbar .el-dropdown {
    width: 100%;
  }

  .toolbar .el-dropdown .el-button {
    width: 100%;
  }

  /* 表格移动端优化 - 隐藏部分列 */
  :deep(.el-table) {
    font-size: 12px;
  }

  :deep(.el-table th),
  :deep(.el-table td) {
    padding: 6px 3px;
  }

  :deep(.el-table .cell) {
    padding: 0 5px;
    line-height: 1.3;
  }

  /* 隐藏选择列和部分不重要的列 */
  :deep(.el-table__column--selection) {
    display: none;
  }

  .domain-cell {
    gap: 1px;
  }

  .meta-text {
    max-width: 120px;
  }

  .status-cell {
    gap: 4px;
  }

  .row-actions {
    gap: 5px;
  }

  .more-actions {
    margin-top: 5px;
  }

  /* 操作按钮优化 */
  :deep(.el-button--small) {
    padding: 4px 6px;
    font-size: 11px;
  }

  :deep(.el-tag--small) {
    padding: 0 4px;
    font-size: 10px;
  }

  /* 分页器移动端优化 */
  :deep(.el-pagination) {
    justify-content: center;
    flex-wrap: wrap;
    gap: 5px;
    padding: 10px 0;
  }

  :deep(.el-pagination .el-pagination__sizes),
  :deep(.el-pagination .el-pagination__jump) {
    display: none;
  }

  /* 对话框移动端优化 */
  :deep(.el-dialog:not(.is-fullscreen)) {
    width: 95% !important;
    margin-top: 5vh !important;
  }

  :deep(.el-dialog__header) {
    padding: 15px;
  }

  :deep(.el-dialog__body) {
    padding: 15px;
    max-height: 70vh;
    overflow-y: auto;
  }

  :deep(.el-dialog__footer) {
    padding: 12px 15px;
  }

  /* 表单优化 */
  :deep(.el-form-item) {
    margin-bottom: 15px;
  }

  :deep(.el-form-item__label) {
    font-size: 13px;
    padding-bottom: 5px;
  }

  :deep(.el-form-item__content) {
    font-size: 13px;
  }

  /* 续费快捷按钮优化 */
  .renew-quick-actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .renew-quick-actions .el-button {
    width: 100%;
    margin: 0;
  }

  .renew-quick-tip {
    font-size: 11px;
    margin-top: 8px;
  }

  /* 批量操作按钮 */
  :deep(.el-dropdown-menu__item) {
    font-size: 13px;
    padding: 8px 15px;
  }
}

/* 小屏手机适配 */
@media (max-width: 480px) {
  .card {
    padding: 10px;
  }

  .card-title {
    font-size: 15px;
  }

  :deep(.el-table) {
    font-size: 10px;
  }

  :deep(.el-button--small) {
    padding: 3px 5px;
    font-size: 10px;
  }

  .renew-quick-actions {
    grid-template-columns: 1fr;
  }
}
</style>
