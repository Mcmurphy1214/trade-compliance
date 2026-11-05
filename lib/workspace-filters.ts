export function validDate(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+"T00:00:00Z");return !Number.isNaN(+d)&&d.toISOString().slice(0,10)===value;}
export function inPublicationRange(date:string|null|undefined,start:string,end:string){
 if(!start&&!end)return true;
 if(start&&!validDate(start)||end&&!validDate(end)||start&&end&&start>end)return false;
 return !!date&&(!start||date>=start)&&(!end||date<=end);
}
