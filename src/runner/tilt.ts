/** Orientation-aware calibration; no browser permission or hardware dependency in the filter. */
export class RunnerTilt {
  private center:number|undefined;
  private filtered=0;
  private angle:number|undefined;
  private lane=1;
  calibrate(){this.center=undefined;this.filtered=0;this.lane=1;}
  sample(beta:number|null,gamma:number|null,angle:number):number|null {
    if(beta===null||gamma===null||!Number.isFinite(beta)||!Number.isFinite(gamma)||!Number.isFinite(angle))return null;
    const normalized=((angle%360)+360)%360;
    if(this.angle!==normalized){this.angle=normalized;this.calibrate();}
    const radians=normalized*Math.PI/180,value=gamma*Math.cos(radians)+beta*Math.sin(radians);
    if(this.center===undefined){this.center=value;return 1;}
    this.filtered+=(value-this.center-this.filtered)*.24;
    if(this.filtered<-12)this.lane=0;else if(this.filtered>12)this.lane=2;else if(Math.abs(this.filtered)<7)this.lane=1;
    return this.lane;
  }
}
