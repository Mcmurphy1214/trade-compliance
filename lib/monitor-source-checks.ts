import {checkUnSanctionsChanges} from "./sanctions-snapshot";

// The existing recording tool can explicitly request checks even when a client
// has not refreshed the newly published standalone MCP tool declarations yet.
export async function runRequestedSourceChecks(run: any) {
  const requested = run?.sourceCheckRequests;
  if (requested === undefined) return run;
  if (!Array.isArray(requested) || requested.length !== 1 || requested[0] !== "un-consolidated") throw new Error("sourceCheckRequests仅支持[un-consolidated]。");
  const result = {...run, checkedSources: [...(run.checkedSources ?? [])], gaps: [...(run.gaps ?? [])], sourceCheckResults: [] as any[]};
  try {
    const check = await checkUnSanctionsChanges();
    result.sourceCheckResults.push({id: "un-consolidated", status: check.baselineCreated ? "baseline_created" : "diff_checked", ...check});
    result.checkedSources.push(`联合国XML https://scsanctions.un.org/resources/xml/en/name/consolidated.xml ：实读${check.individuals}名个人、${check.entities}个实体；${check.baselineCreated ? "已持久化首个逐条DATAID哈希基线" : `相对上次快照新增${check.added.length}、移除${check.removed.length}、资料变化${check.changed.length}`}。采集时点${check.checkedAt}；文件生成时间不当作政策日期。`);
    if (check.baselineCreated) result.gaps.push("联合国名单已建立当前持久化基线，但缺少上期历史快照，本次不能补造历史差分。下一轮可比较稳定DATAID及内容哈希；变动仍须回查委员会通告和生效日期。");
    else if (check.added.length || check.removed.length || check.changed.length) result.gaps.push("联合国机器名单发现相对前次快照的记录差异，尚须逐项核实委员会公告及生效日期；快照差异本身不等于已确认本轮窗口内新制裁。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "官方XML读取失败";
    result.sourceCheckResults.push({id: "un-consolidated", status: "access_failed", error: message, checkedAt: new Date().toISOString()});
    result.gaps.push("联合国XML基线/差分本次失败，原基线保留：" + message);
  }
  if (result.gaps.length) result.status = "部分完成";
  return result;
}
